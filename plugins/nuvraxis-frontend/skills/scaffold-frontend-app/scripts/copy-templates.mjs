#!/usr/bin/env node
// Copies the plugin's templates/ into a target directory, replacing __APP__ with the app name
// in paths and file contents, and renaming the dotfiles that can't ship under their own names.
//
//   node copy-templates.mjs <app-name> <target-dir> [--force]
//
// Refuses to overwrite existing files unless --force is given. Prints every file it writes.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TEMPLATES = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "templates");
// Shipped without the leading dot: a .gitignore inside the plugin would apply to the plugin repo.
const RENAMES = new Map([
	["gitignore", ".gitignore"],
	["gitattributes", ".gitattributes"],
]);

const [rawName, rawTarget, ...flags] = process.argv.slice(2);
const force = flags.includes("--force");

if (!rawName || !rawTarget) {
	console.error("usage: node copy-templates.mjs <app-name> <target-dir> [--force]");
	process.exit(2);
}

// GHCR image names, Helm chart names, Kubernetes resource names and package names all need
// lowercase DNS-label-style names.
const name = rawName.toLowerCase();
if (!/^[a-z][a-z0-9-]{0,40}[a-z0-9]$/.test(name)) {
	console.error(`"${rawName}" isn't a valid app name: use 2-42 lowercase letters, digits and dashes, starting with a letter.`);
	process.exit(2);
}

const target = resolve(rawTarget);

function walk(dir) {
	const files = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) files.push(...walk(full));
		else files.push(full);
	}
	return files;
}

const plan = walk(TEMPLATES).map((source) => {
	const parts = relative(TEMPLATES, source).split(sep).map((part) => part.replaceAll("__APP__", name));
	const last = parts.length - 1;
	parts[last] = RENAMES.get(parts[last]) ?? parts[last];
	return { source, destination: join(target, ...parts) };
});

const clashes = plan.filter(({ destination }) => existsSync(destination));
if (clashes.length > 0 && !force) {
	console.error("These files already exist (re-run with --force to overwrite):");
	for (const { destination } of clashes) console.error(`  ${relative(target, destination)}`);
	process.exit(1);
}

for (const { source, destination } of plan) {
	mkdirSync(dirname(destination), { recursive: true });
	const buffer = readFileSync(source);
	// Binary files (none today) are copied untouched; text gets the placeholder replaced.
	const isText = !buffer.includes(0);
	writeFileSync(destination, isText ? buffer.toString("utf8").replaceAll("__APP__", name) : buffer);
	console.log(relative(target, destination).split(sep).join("/"));
}
