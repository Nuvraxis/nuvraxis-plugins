#!/usr/bin/env node
// Vendors upstream skills into plugins/nuvraxis-frontend/skills/<name>/ and pins
// the commit in UPSTREAM.json.
//
//   pnpm sync            fetch each source's default branch, copy, rewrite UPSTREAM.json
//   pnpm sync --check    fetch the pinned commits and fail if the vendored copies differ
//
// Node only (no bash) so it runs the same on Windows, macOS and Linux. Needs git on PATH.

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SOURCES = [
	{ name: "nuvui", repo: "Nuvraxis/nuvui", path: "skills/nuvui" },
	{ name: "turborepo", repo: "vercel/turborepo", path: "skills/turborepo" },
];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS_DIR = join(ROOT, "plugins", "nuvraxis-frontend", "skills");
const UPSTREAM_FILE = join(ROOT, "UPSTREAM.json");
// Our own file inside each vendored folder; never part of the upstream comparison.
const MARKER = "VENDORED.md";

const check = process.argv.includes("--check");

function git(args, cwd) {
	const result = spawnSync("git", args, { cwd, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
	}
	return result.stdout.trim();
}

// Shallow, sparse, blob-filtered fetch of one folder at one ref. `ref` is a branch
// name, "HEAD" or a full commit SHA (GitHub allows fetching any reachable SHA).
function fetchSource(source, ref) {
	const dir = mkdtempSync(join(tmpdir(), `sync-${source.name}-`));
	git(["init", "--quiet"], dir);
	git(["remote", "add", "origin", `https://github.com/${source.repo}.git`], dir);
	git(["config", "core.autocrlf", "false"], dir);
	git(["sparse-checkout", "set", "--no-cone", `/${source.path}/`], dir);
	git(["fetch", "--quiet", "--depth", "1", "--filter=blob:none", "origin", ref], dir);
	git(["checkout", "--quiet", "FETCH_HEAD"], dir);
	const commit = git(["rev-parse", "HEAD"], dir);
	const date = git(["log", "-1", "--format=%cI"], dir);
	const folder = join(dir, ...source.path.split("/"));
	if (!existsSync(folder)) {
		rmSync(dir, { recursive: true, force: true });
		throw new Error(`${source.repo}@${commit} has no ${source.path}/`);
	}
	return { dir, folder, commit, date };
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

function vendoredNote(source, commit) {
	return `# Vendored skill: do not edit

This folder is a verbatim copy of [\`${source.path}\`](https://github.com/${source.repo}/tree/${commit}/${source.path}) from \`${source.repo}\`, pinned in \`UPSTREAM.json\` at the repository root.

Regenerate it with \`pnpm sync\` from the repository root. CI runs \`pnpm sync --check\` and fails if anything here differs from the pinned commit, so local edits will not survive. Change the upstream repository instead, or put project-specific guidance in one of the plugin's own skills.
`;
}

function readUpstream() {
	if (!existsSync(UPSTREAM_FILE)) return { skills: {} };
	return JSON.parse(readFileSync(UPSTREAM_FILE, "utf8"));
}

function runCheck() {
	const pinned = readUpstream().skills ?? {};
	let failed = false;
	for (const source of SOURCES) {
		const pin = pinned[source.name];
		if (!pin) {
			console.error(`✗ ${source.name}: not pinned in UPSTREAM.json (run pnpm sync)`);
			failed = true;
			continue;
		}
		const fetched = fetchSource(source, pin.commit);
		try {
			const problems = diff(fetched.folder, join(SKILLS_DIR, source.name));
			if (problems.length > 0) {
				failed = true;
				console.error(`✗ ${source.name}: differs from ${source.repo}@${pin.commit.slice(0, 7)}`);
				for (const line of problems) console.error(`    ${line}`);
			} else {
				console.log(`✓ ${source.name} matches ${source.repo}@${pin.commit.slice(0, 7)}`);
			}
		} finally {
			rmSync(fetched.dir, { recursive: true, force: true });
		}
	}
	if (failed) {
		console.error("\nVendored skills drifted. Run `pnpm sync` and commit the result.");
		process.exit(1);
	}
}

function runSync() {
	const skills = {};
	for (const source of SOURCES) {
		const fetched = fetchSource(source, "HEAD");
		try {
			const target = join(SKILLS_DIR, source.name);
			rmSync(target, { recursive: true, force: true });
			cpSync(fetched.folder, target, { recursive: true });
			writeFileSync(join(target, MARKER), vendoredNote(source, fetched.commit));
			skills[source.name] = { repo: source.repo, path: source.path, commit: fetched.commit, date: fetched.date };
			console.log(`✓ ${source.name} ← ${source.repo}@${fetched.commit.slice(0, 7)} (${fetched.date})`);
		} finally {
			rmSync(fetched.dir, { recursive: true, force: true });
		}
	}
	writeFileSync(UPSTREAM_FILE, `${JSON.stringify({ skills }, null, "\t")}\n`);
	console.log(`\nWrote ${relative(ROOT, UPSTREAM_FILE)}`);
}

try {
	if (check) runCheck();
	else runSync();
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
