#!/usr/bin/env node
// Vendors upstream skills into the plugins and pins them in UPSTREAM.json.
//
//   pnpm sync            refresh every source, copy, rewrite UPSTREAM.json
//   pnpm sync --check    re-fetch the pinned sources and fail if the vendored copies differ
//
// Two kinds of source:
//   git   a folder of a GitHub repo at its default branch's HEAD (pinned by commit SHA)
//   npm   the skills a package ships in its registry tarball, at the version a template pins,
//         verified against the registry's integrity hash. The version is read from the
//         template, so the app's dependency and the vendored skills can't drift apart.
//
// Node only (no bash) so it runs the same on Windows, macOS and Linux. Needs git and tar on
// PATH (both ship with Windows 10+, macOS and Linux).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginSkills = (plugin) => join(ROOT, "plugins", plugin, "skills");

const GIT_SOURCES = [
	{ name: "nuvui", plugin: "nuvraxis-frontend", repo: "Nuvraxis/nuvui", path: "skills/nuvui" },
	{ name: "turborepo", plugin: "nuvraxis-frontend", repo: "vercel/turborepo", path: "skills/turborepo" },
];

const NPM_SOURCES = [
	{
		package: "drizzle-kit",
		plugin: "nuvraxis-fullstack",
		path: "skills",
		// The one place the drizzle-kit version is written down.
		versionFrom: "plugins/nuvraxis-fullstack/templates/pnpm-catalog.yaml",
		// drizzle → drizzle-kit, drizzle-generate → drizzle-kit-generate, …
		folderName: (skill) => skill.replace(/^drizzle/, "drizzle-kit"),
	},
];

const UPSTREAM_FILE = join(ROOT, "UPSTREAM.json");
// Our own file inside each vendored folder; never part of the upstream comparison.
const MARKER = "VENDORED.md";

const check = process.argv.includes("--check");

function run(command, args, cwd) {
	const result = spawnSync(command, args, { cwd, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
	}
	return result.stdout.trim();
}

function listFiles(root) {
	const out = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) walk(full);
			else out.push(relative(root, full).split(sep).join("/"));
		}
	};
	walk(root);
	return out.filter((file) => file !== MARKER).sort();
}

// Line endings are normalised so a Windows checkout with autocrlf still compares equal.
function sameContent(a, b) {
	const norm = (file) => readFileSync(file).toString("latin1").replaceAll("\r\n", "\n");
	return norm(a) === norm(b);
}

function diff(upstreamFolder, vendoredFolder) {
	if (!existsSync(vendoredFolder)) return ["(folder missing)"];
	const upstream = listFiles(upstreamFolder);
	const vendored = listFiles(vendoredFolder);
	const problems = [];
	for (const file of upstream) {
		if (!vendored.includes(file)) problems.push(`missing  ${file}`);
		else if (!sameContent(join(upstreamFolder, file), join(vendoredFolder, file))) problems.push(`changed  ${file}`);
	}
	for (const file of vendored) {
		if (!upstream.includes(file)) problems.push(`extra    ${file}`);
	}
	return problems;
}

function vendor(fromFolder, toFolder, note) {
	rmSync(toFolder, { recursive: true, force: true });
	cpSync(fromFolder, toFolder, { recursive: true });
	writeFileSync(join(toFolder, MARKER), note);
}

// ---- git sources ----

// Shallow, sparse, blob-filtered fetch of one folder at one ref ("HEAD" or a full commit SHA).
function fetchGit(source, ref) {
	const dir = mkdtempSync(join(tmpdir(), `sync-${source.name}-`));
	run("git", ["init", "--quiet"], dir);
	run("git", ["remote", "add", "origin", `https://github.com/${source.repo}.git`], dir);
	run("git", ["config", "core.autocrlf", "false"], dir);
	run("git", ["sparse-checkout", "set", "--no-cone", `/${source.path}/`], dir);
	run("git", ["fetch", "--quiet", "--depth", "1", "--filter=blob:none", "origin", ref], dir);
	run("git", ["checkout", "--quiet", "FETCH_HEAD"], dir);
	const commit = run("git", ["rev-parse", "HEAD"], dir);
	const date = run("git", ["log", "-1", "--format=%cI"], dir);
	const folder = join(dir, ...source.path.split("/"));
	if (!existsSync(folder)) {
		rmSync(dir, { recursive: true, force: true });
		throw new Error(`${source.repo}@${commit} has no ${source.path}/`);
	}
	return { dir, folder, commit, date };
}

function gitNote(source, commit) {
	return `# Vendored skill: do not edit

This folder is a verbatim copy of [\`${source.path}\`](https://github.com/${source.repo}/tree/${commit}/${source.path}) from \`${source.repo}\`, pinned in \`UPSTREAM.json\` at the repository root.

Regenerate it with \`pnpm sync\` from the repository root. CI runs \`pnpm sync --check\` and fails if anything here differs from the pinned commit, so local edits will not survive. Change the upstream repository instead, or put project-specific guidance in one of the plugin's own skills.
`;
}

// ---- npm sources ----

function pinnedVersion(source) {
	const text = readFileSync(join(ROOT, source.versionFrom), "utf8");
	const escaped = source.package.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
	// `  drizzle-kit: 1.0.0-rc.4` on one line; a bare `drizzle-kit:` map key (permissions) doesn't count.
	const match = new RegExp(`^[ \\t]+"?${escaped}"?:[ \\t]*([^\\s#]+)`, "m").exec(text);
	if (!match) throw new Error(`${source.versionFrom} doesn't pin ${source.package}`);
	return match[1];
}

async function fetchNpm(source, version) {
	const metaUrl = `https://registry.npmjs.org/${source.package}/${version}`;
	const meta = await fetch(metaUrl);
	if (!meta.ok) throw new Error(`${metaUrl}: HTTP ${meta.status}`);
	const { dist } = await meta.json();
	const tarball = await fetch(dist.tarball);
	if (!tarball.ok) throw new Error(`${dist.tarball}: HTTP ${tarball.status}`);
	const bytes = Buffer.from(await tarball.arrayBuffer());
	const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
	if (integrity !== dist.integrity) {
		throw new Error(`${source.package}@${version}: tarball integrity ${integrity} doesn't match the registry's ${dist.integrity}`);
	}
	const dir = mkdtempSync(join(tmpdir(), `sync-${source.package}-`));
	writeFileSync(join(dir, "package.tgz"), bytes);
	run("tar", ["-xzf", "package.tgz"], dir);
	const folder = join(dir, "package", ...source.path.split("/"));
	if (!existsSync(folder)) {
		rmSync(dir, { recursive: true, force: true });
		throw new Error(`${source.package}@${version} ships no ${source.path}/`);
	}
	const skills = readdirSync(folder).filter((entry) => statSync(join(folder, entry)).isDirectory()).sort();
	return { dir, folder, integrity, tarball: dist.tarball, skills };
}

function npmNote(source, version, skill) {
	return `# Vendored skill: do not edit

This folder is a verbatim copy of \`${source.path}/${skill}\` from the npm package \`${source.package}@${version}\`, taken from the registry tarball and verified against its integrity hash. The version is the one \`${source.versionFrom}\` pins for generated apps, so the skill always matches the \`${source.package}\` the app installs. Package, version and integrity are recorded in \`UPSTREAM.json\`.

To update: change the version in \`${source.versionFrom}\`, then run \`pnpm sync\` from the repository root. CI runs \`pnpm sync --check\` and fails if anything here differs, so local edits will not survive.

The skill may suggest running \`drizzle-kit skills\` to refresh: with this plugin installed, refreshing happens through the plugin's version instead.
`;
}

// ---- main ----

function readUpstream() {
	if (!existsSync(UPSTREAM_FILE)) return {};
	return JSON.parse(readFileSync(UPSTREAM_FILE, "utf8"));
}

async function runSync() {
	const skills = {};
	for (const source of GIT_SOURCES) {
		const fetched = fetchGit(source, "HEAD");
		try {
			vendor(fetched.folder, join(pluginSkills(source.plugin), source.name), gitNote(source, fetched.commit));
			skills[source.name] = { plugin: source.plugin, repo: source.repo, path: source.path, commit: fetched.commit, date: fetched.date };
			console.log(`✓ ${source.name} ← ${source.repo}@${fetched.commit.slice(0, 7)} (${fetched.date})`);
		} finally {
			rmSync(fetched.dir, { recursive: true, force: true });
		}
	}

	const packages = {};
	for (const source of NPM_SOURCES) {
		const version = pinnedVersion(source);
		const fetched = await fetchNpm(source, version);
		try {
			const folders = {};
			for (const skill of fetched.skills) {
				const folder = source.folderName(skill);
				vendor(join(fetched.folder, skill), join(pluginSkills(source.plugin), folder), npmNote(source, version, skill));
				folders[skill] = folder;
			}
			packages[source.package] = {
				plugin: source.plugin,
				version,
				integrity: fetched.integrity,
				tarball: fetched.tarball,
				path: source.path,
				versionFrom: source.versionFrom,
				skills: folders,
			};
			console.log(`✓ ${source.package}@${version}: ${fetched.skills.length} skills → ${Object.values(folders).join(", ")}`);
		} finally {
			rmSync(fetched.dir, { recursive: true, force: true });
		}
	}

	writeFileSync(UPSTREAM_FILE, `${JSON.stringify({ skills, packages }, null, "\t")}\n`);
	console.log(`\nWrote ${relative(ROOT, UPSTREAM_FILE)}`);
}

async function runCheck() {
	const pinned = readUpstream();
	const problems = [];
	const report = (line) => problems.push(line);

	for (const source of GIT_SOURCES) {
		const pin = pinned.skills?.[source.name];
		if (!pin) {
			report(`✗ ${source.name}: not pinned in UPSTREAM.json (run pnpm sync)`);
			continue;
		}
		const fetched = fetchGit(source, pin.commit);
		try {
			const found = diff(fetched.folder, join(pluginSkills(source.plugin), source.name));
			if (found.length > 0) report(`✗ ${source.name}: differs from ${source.repo}@${pin.commit.slice(0, 7)}\n    ${found.join("\n    ")}`);
			else console.log(`✓ ${source.name} matches ${source.repo}@${pin.commit.slice(0, 7)}`);
		} finally {
			rmSync(fetched.dir, { recursive: true, force: true });
		}
	}

	for (const source of NPM_SOURCES) {
		const pin = pinned.packages?.[source.package];
		const version = pinnedVersion(source);
		if (!pin) {
			report(`✗ ${source.package}: not pinned in UPSTREAM.json (run pnpm sync)`);
			continue;
		}
		if (pin.version !== version) {
			report(`✗ ${source.package}: ${source.versionFrom} pins ${version} but the vendored skills are ${pin.version} (run pnpm sync)`);
			continue;
		}
		const fetched = await fetchNpm(source, version);
		try {
			if (fetched.integrity !== pin.integrity) report(`✗ ${source.package}@${version}: integrity changed since it was vendored`);
			const expected = Object.fromEntries(fetched.skills.map((skill) => [skill, source.folderName(skill)]));
			if (JSON.stringify(expected) !== JSON.stringify(pin.skills)) report(`✗ ${source.package}@${version}: the set of skills differs from UPSTREAM.json`);
			let clean = true;
			for (const [skill, folder] of Object.entries(expected)) {
				const found = diff(join(fetched.folder, skill), join(pluginSkills(source.plugin), folder));
				if (found.length > 0) {
					clean = false;
					report(`✗ ${folder}: differs from ${source.package}@${version}\n    ${found.join("\n    ")}`);
				}
			}
			if (clean) console.log(`✓ ${Object.keys(expected).length} ${source.package} skills match ${source.package}@${version} (${pin.integrity.slice(0, 19)}…)`);
		} finally {
			rmSync(fetched.dir, { recursive: true, force: true });
		}
	}

	if (problems.length > 0) {
		console.error(problems.join("\n"));
		console.error("\nVendored skills drifted. Run `pnpm sync` and commit the result.");
		process.exit(1);
	}
}

try {
	if (check) await runCheck();
	else await runSync();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
