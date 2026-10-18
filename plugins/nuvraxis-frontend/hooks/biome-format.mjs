#!/usr/bin/env node
// PostToolUse hook for Edit|Write: runs `biome check --write <file>` with the project's own
// Biome when the edited file sits under a biome.json inside the project. Anywhere else it does
// nothing: no output, exit 0. It never fails the tool call; `biome ci` in the Verify steps is
// where errors surface.
//
// Safety: no shell is involved (the file path is passed as a single argv element to Node), and
// both the config and the Biome install are looked up only inside the project directory, never
// in an ancestor of it.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";

// Extensions Biome formats or lints. SCSS is stylelint's job, so it isn't here.
const BIOME_EXTENSIONS = new Set([
	".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts",
	".json", ".jsonc", ".css", ".graphql", ".gql",
]);
const CONFIG_NAMES = ["biome.json", "biome.jsonc"];
// The package's JS launcher, which picks the platform binary itself. Running it with
// process.execPath works the same on every OS and needs no shell.
const BIOME_ENTRY = join("node_modules", "@biomejs", "biome", "bin", "biome");

function readInput() {
	try {
		return JSON.parse(readFileSync(0, "utf8"));
	} catch {
		return {};
	}
}

function isInside(root, path) {
	const rel = relative(root, path);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

// Walks up from `start` to `root` (inclusive) and returns the first directory where `test` holds.
function findUp(start, root, test) {
	let dir = start;
	for (;;) {
		if (test(dir)) return dir;
		if (dir === root) return undefined;
		const parent = dirname(dir);
		if (parent === dir || !isInside(root, parent)) return undefined;
		dir = parent;
	}
}

function main() {
	const input = readInput();
	const raw = input.tool_input?.file_path;
	if (typeof raw !== "string" || raw.length === 0) return;

	const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd;
	if (typeof projectDir !== "string" || projectDir.length === 0) return;
	const root = resolve(projectDir);

	const file = isAbsolute(raw) ? resolve(raw) : resolve(input.cwd ?? root, raw);
	if (!isInside(root, file)) return;
	if (!BIOME_EXTENSIONS.has(extname(file).toLowerCase()) || !existsSync(file)) return;
	if (file.split(/[\\/]/).includes("node_modules")) return;

	const configDir = findUp(dirname(file), root, (dir) => CONFIG_NAMES.some((name) => existsSync(join(dir, name))));
	if (!configDir) return;

	// Biome not installed yet (fresh clone, no `pnpm install`): stay silent.
	const installDir = findUp(configDir, root, (dir) => existsSync(join(dir, BIOME_ENTRY)));
	if (!installDir) return;

	spawnSync(process.execPath, [join(installDir, BIOME_ENTRY), "check", "--write", "--no-errors-on-unmatched", file], {
		cwd: configDir,
		stdio: "ignore",
		timeout: 25_000,
		windowsHide: true,
	});
}

try {
	main();
} catch {
	// A formatter hook must never block an edit.
}
process.exit(0);
