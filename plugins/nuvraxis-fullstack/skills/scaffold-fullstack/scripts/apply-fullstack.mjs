#!/usr/bin/env node
// Adds the nuvraxis-fullstack database layer to a repo created by nuvraxis-frontend's scaffold.
//
//   node apply-fullstack.mjs <app-name> <repo-dir> [--scope <scope>] [--check]
//
// --check runs only the precheck. Without it, the script changes files and prints each one.
// It refuses to run twice (packages/db exists) and never overwrites a file it didn't create.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { applyChartOverlay } from "./apply-chart-overlay.mjs";

const TEMPLATES = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "templates");

const args = process.argv.slice(2);
const [app, rawDir] = args.filter((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--scope");
const scopeFlag = args.includes("--scope") ? args[args.indexOf("--scope") + 1] : undefined;
const checkOnly = args.includes("--check");

if (!app || !rawDir) {
	console.error("usage: node apply-fullstack.mjs <app-name> <repo-dir> [--scope <scope>] [--check]");
	process.exit(2);
}

const repo = resolve(rawDir);
const read = (file) => readFileSync(file, "utf8").replaceAll("\r\n", "\n");
const at = (...parts) => join(repo, ...parts);
const changed = [];
const note = (path) => changed.push(path.split(sep).join("/"));

// ---- 1. precheck: a nuvraxis-frontend scaffold, possibly made days ago ----

function precheck() {
	const problems = [];
	if (!existsSync(at("turbo.json"))) problems.push("turbo.json at the repo root");
	const nextConfig = at("apps", app, "next.config.ts");
	if (!existsSync(nextConfig)) problems.push(`apps/${app}/next.config.ts`);
	else if (!/output:\s*["']standalone["']/.test(read(nextConfig))) problems.push(`output: "standalone" in apps/${app}/next.config.ts`);
	if (!existsSync(at("charts", app, "Chart.yaml"))) problems.push(`charts/${app}/Chart.yaml`);
	if (!existsSync(at(".github", "workflows", "pr.yaml"))) problems.push(".github/workflows/pr.yaml");
	return problems;
}

const problems = precheck();
if (problems.length > 0) {
	console.error(`This isn't a nuvraxis-frontend repo for "${app}". Missing:`);
	for (const problem of problems) console.error(`  - ${problem}`);
	console.error(`\nRun /nuvraxis-frontend:scaffold-frontend-app ${app} first (install it with /plugin install nuvraxis-frontend@nuvraxis-plugins).`);
	process.exit(3);
}
if (existsSync(at("packages", "db"))) {
	console.error("packages/db already exists: the database layer has been added before. Nothing changed.");
	process.exit(1);
}

// The workspace scope the frontend scaffold chose: the scope of the app's tsconfig package.
function detectScope() {
	const pkg = JSON.parse(read(at("apps", app, "package.json")));
	const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
	const match = names.map((name) => /^@([^/]+)\/tsconfig$/.exec(name)).find(Boolean);
	return match ? match[1] : "repo";
}
const scope = scopeFlag ?? detectScope();

if (checkOnly) {
	console.log(`ok: nuvraxis-frontend repo for "${app}", workspace scope @${scope}`);
	process.exit(0);
}

const fill = (text) => text.replaceAll("__APP__", app).replaceAll("__SCOPE__", scope);

// ---- helpers ----

function walk(dir) {
	const files = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) files.push(...walk(full));
		else files.push(full);
	}
	return files;
}

function copyTree(from, to) {
	for (const source of walk(from)) {
		const rel = fill(relative(from, source));
		const target = join(to, rel);
		if (existsSync(target)) throw new Error(`${relative(repo, target)} already exists; not overwriting it`);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, fill(read(source)));
		note(relative(repo, target));
	}
}

function copyFile(templateName, targetRel) {
	const target = at(targetRel);
	if (existsSync(target)) throw new Error(`${targetRel} already exists; not overwriting it`);
	writeFileSync(target, fill(read(join(TEMPLATES, templateName))));
	note(targetRel);
}

function editJson(rel, change) {
	const file = at(rel);
	const data = existsSync(file) ? JSON.parse(read(file)) : {};
	change(data);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
	note(rel);
}

const sortKeys = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b)));

// Entries of a top-level YAML map in the flat `key: value` form pnpm-workspace.yaml uses.
function yamlBlock(text, key) {
	const lines = text.split("\n");
	const start = lines.findIndex((line) => line === `${key}:`);
	if (start === -1) return undefined;
	let end = start + 1;
	while (end < lines.length && (/^\s+\S/.test(lines[end]) || lines[end].trim().startsWith("#"))) end++;
	const entries = lines.slice(start + 1, end).filter((line) => /^\s+[^\s#]/.test(line));
	return { start, end, entries, lines };
}
const entryKey = (line) => line.trim().split(":")[0].replaceAll('"', "");

function mergeYamlBlock(text, key, newEntries) {
	const block = yamlBlock(text, key);
	if (!block) return `${text.replace(/\n*$/, "\n")}\n${key}:\n${newEntries.join("\n")}\n`;
	const existing = new Set(block.entries.map(entryKey));
	const additions = newEntries.filter((line) => !existing.has(entryKey(line)));
	if (additions.length === 0) return text;
	// Insert after the block's last entry, keeping any trailing comments in place.
	let insertAt = block.end;
	while (insertAt > block.start + 1 && !/^\s+[^\s#]/.test(block.lines[insertAt - 1])) insertAt--;
	block.lines.splice(insertAt, 0, ...additions);
	return block.lines.join("\n");
}

// ---- 2. packages/db ----

copyTree(join(TEMPLATES, "packages", "db"), at("packages", "db"));

// ---- 3. workspace catalog + allowBuilds ----

{
	const catalog = read(join(TEMPLATES, "pnpm-catalog.yaml"));
	let workspace = read(at("pnpm-workspace.yaml"));
	for (const key of ["catalog", "allowBuilds"]) {
		const block = yamlBlock(catalog, key);
		if (block) workspace = mergeYamlBlock(workspace, key, block.entries);
	}
	writeFileSync(at("pnpm-workspace.yaml"), workspace);
	note("pnpm-workspace.yaml");
}

// ---- 4. app dependency, root scripts, turbo env ----

editJson(join("apps", app, "package.json"), (pkg) => {
	pkg.dependencies = sortKeys({ ...pkg.dependencies, [`@${scope}/db`]: "workspace:*" });
});

editJson("package.json", (pkg) => {
	for (const script of ["db:generate", "db:check", "db:migrate", "db:seed", "db:studio"]) {
		pkg.scripts[script] = `pnpm --filter @${scope}/db ${script}`;
	}
});

editJson("turbo.json", (turbo) => {
	const test = (turbo.tasks.test ??= {});
	test.env = [...new Set([...(test.env ?? []), "DATABASE_URL"])];
});

// ---- 5. local Postgres, env example, CLAUDE.md ----

copyFile("compose.yaml", "compose.yaml");
copyFile(".env.example", ".env.example");
{
	const claude = at("CLAUDE.md");
	const text = existsSync(claude) ? read(claude) : "";
	if (!text.includes("## Database (nuvraxis-fullstack)")) {
		writeFileSync(claude, text.replace(/\n*$/, "\n") + fill(read(join(TEMPLATES, "CLAUDE.db.md"))));
		note("CLAUDE.md");
	}
}

// ---- 6. Dockerfile: two COPY lines in the runner stage ----

{
	const rel = join("apps", app, "Dockerfile");
	const dockerfile = read(at(rel));
	const anchor = `COPY --from=builder /repo/apps/${app}/public ./apps/${app}/public\n`;
	if (!dockerfile.includes(anchor)) throw new Error(`${rel}: the runner's "COPY … public" line wasn't found; apply Dockerfile.patch.md by hand`);
	if (!dockerfile.includes("packages/db/dist/migrate.mjs")) {
		writeFileSync(at(rel), dockerfile.replace(anchor, anchor + fill(read(join(TEMPLATES, "Dockerfile.migrate.snippet")))));
		note(rel);
	}
}

// ---- 7. Helm chart ----

for (const path of applyChartOverlay(app, repo)) note(path);

// ---- 8. pr.yaml: one more job, appended to `jobs:` (its last top-level key) ----

{
	const rel = join(".github", "workflows", "pr.yaml");
	const pr = read(at(rel));
	if (!/^ {2}db:$/m.test(pr)) {
		writeFileSync(at(rel), `${pr.replace(/\n*$/, "\n")}\n${fill(read(join(TEMPLATES, "workflows-overlay", "pr.db.yaml")))}`);
		note(rel);
	}
}

// ---- 9. drizzle-kit MCP: listed, but disabled until someone opts in ----

editJson(".mcp.json", (mcp) => {
	mcp.mcpServers ??= {};
	mcp.mcpServers.drizzle ??= {
		type: "stdio",
		command: "pnpm",
		args: ["--dir", "packages/db", "exec", "drizzle-kit", "mcp"],
	};
});
editJson(join(".claude", "settings.json"), (settings) => {
	settings.disabledMcpjsonServers = [...new Set([...(settings.disabledMcpjsonServers ?? []), "drizzle"])];
});

// ---- 10. the example: users page → Server Action → valibot schema → query function ----

copyTree(join(TEMPLATES, "app-example"), repo);

console.log(changed.join("\n"));
console.log(`\nDatabase layer added for "${app}" (workspace scope @${scope}).`);
