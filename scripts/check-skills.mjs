#!/usr/bin/env node
// Checks the plugin's own skills against the authoring standard, and that every template file
// embedded in a skill is byte-for-byte the file in templates/.
//
//   pnpm check
//
// Own skill = a folder under skills/ without VENDORED.md. For each one:
//   - SKILL.md with frontmatter `name` (equal to the folder) and `description`, at most 300 lines
//   - "## Verify" and "## Sources" sections, and a references/ folder with at least one .md file
//   - evals/evals.json with at least 3 evals, each with id, prompt and expect, every pattern a valid RegExp
//   - relative Markdown links that resolve
// In any Markdown file of an own skill, a line `<!-- template: <path> -->` followed by a fenced
// block means the block must equal templates/<path>.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = join(ROOT, "plugins", "nuvraxis-frontend");
const SKILLS = join(PLUGIN, "skills");
const TEMPLATES = join(PLUGIN, "templates");
const MAX_LINES = 300;

const problems = [];
const report = (file, message) => problems.push(`${relative(ROOT, file).replaceAll("\\", "/")}: ${message}`);
const read = (file) => readFileSync(file, "utf8").replaceAll("\r\n", "\n");

function markdownFiles(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) out.push(...markdownFiles(full));
		else if (entry.endsWith(".md")) out.push(full);
	}
	return out;
}

function frontmatter(text) {
	const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
	if (!match) return undefined;
	const fields = {};
	for (const line of match[1].split("\n")) {
		const field = /^([a-z][a-z_-]*):\s*(.*)$/.exec(line);
		if (field) fields[field[1]] = field[2];
	}
	return fields;
}

function checkSkillFile(skillDir, name) {
	const file = join(skillDir, "SKILL.md");
	if (!existsSync(file)) return report(skillDir, "missing SKILL.md");
	const text = read(file);
	const fields = frontmatter(text);
	if (!fields) return report(file, "missing frontmatter");
	if (fields.name !== name) report(file, `frontmatter name "${fields.name}" doesn't match the folder "${name}"`);
	if (!fields.description) report(file, "frontmatter has no description");
	// claude.ai rejects XML-like tags in descriptions and strips angle brackets on sync.
	// Checks every frontmatter line except argument-hint and YAML block headers (`key: >-`).
	const header = /^---\n([\s\S]*?)\n---\n/.exec(text)[1];
	for (const line of header.split("\n")) {
		if (/^argument-hint:/.test(line) || /^[a-z_-]+:\s*[>|][-+]?\s*$/.test(line)) continue;
		if (/[<>]/.test(line)) report(file, `angle brackets in frontmatter (claude.ai rejects them): ${line.trim().slice(0, 80)}`);
	}
	const lines = text.split("\n").length;
	if (lines > MAX_LINES) report(file, `${lines} lines; the limit is ${MAX_LINES}`);
	for (const heading of ["## Verify", "## Sources"]) {
		if (!text.includes(`\n${heading}\n`)) report(file, `no "${heading}" section`);
	}
}

function checkReferences(skillDir) {
	const dir = join(skillDir, "references");
	if (!existsSync(dir) || !readdirSync(dir).some((f) => f.endsWith(".md"))) {
		report(skillDir, "no references/*.md");
	}
}

function checkEvals(skillDir) {
	const file = join(skillDir, "evals", "evals.json");
	if (!existsSync(file)) return report(skillDir, "missing evals/evals.json");
	let data;
	try {
		data = JSON.parse(read(file));
	} catch (error) {
		return report(file, `invalid JSON: ${error.message}`);
	}
	const evals = Array.isArray(data.evals) ? data.evals : [];
	if (evals.length < 3) report(file, `${evals.length} evals; at least 3 are required`);
	for (const item of evals) {
		const id = item.id ?? "(no id)";
		if (!item.id || !item.prompt || !Array.isArray(item.expect)) report(file, `eval ${id} needs id, prompt and expect`);
		for (const check of [...(item.expect ?? []), ...(item.reject ?? [])]) {
			try {
				new RegExp(check.pattern);
			} catch (error) {
				report(file, `eval ${id}: invalid pattern ${JSON.stringify(check.pattern)}: ${error.message}`);
			}
			if (!check.why) report(file, `eval ${id}: pattern ${JSON.stringify(check.pattern)} has no "why"`);
		}
	}
}

function checkMarkdown(file) {
	const text = read(file);
	// Relative links, ignoring URLs, anchors and ${...} placeholders.
	for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
		if (/^(https?:|mailto:|#|\$\{)/.test(target)) continue;
		const path = resolve(dirname(file), target.split("#")[0]);
		if (!existsSync(path)) report(file, `broken link to ${target}`);
	}
	// Embedded templates.
	const embedded = /<!-- template: (\S+) -->\n```[^\n]*\n([\s\S]*?)\n```(?:\n|$)/g;
	for (const [, templatePath, block] of text.matchAll(embedded)) {
		const source = join(TEMPLATES, ...templatePath.split("/"));
		if (!existsSync(source)) {
			report(file, `embeds templates/${templatePath}, which doesn't exist`);
			continue;
		}
		if (read(source).replace(/\n$/, "") !== block) {
			report(file, `embedded copy of templates/${templatePath} has drifted; regenerate it from the template`);
		}
	}
}

const skills = readdirSync(SKILLS).filter((name) => statSync(join(SKILLS, name)).isDirectory());
const own = skills.filter((name) => !existsSync(join(SKILLS, name, "VENDORED.md")));

for (const name of own) {
	const dir = join(SKILLS, name);
	checkSkillFile(dir, name);
	checkReferences(dir);
	checkEvals(dir);
	for (const file of markdownFiles(dir)) checkMarkdown(file);
}
checkMarkdown(join(TEMPLATES, "CLAUDE.md"));

if (problems.length > 0) {
	console.error(problems.map((p) => `✗ ${p}`).join("\n"));
	console.error(`\n${problems.length} problem(s) in ${own.length} own skills.`);
	process.exit(1);
}
console.log(`✓ ${own.length} own skills meet the standard; embedded templates match (vendored: ${skills.length - own.length}).`);
