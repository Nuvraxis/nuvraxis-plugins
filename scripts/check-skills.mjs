#!/usr/bin/env node
// Checks every plugin's own skills against the authoring standard, and that every template file
// embedded in a skill is byte-for-byte the file in that plugin's templates/.
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

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS = join(ROOT, "plugins");
const MAX_LINES = 300;
const FIX = process.argv.includes("--fix");

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

function checkMarkdown(file, templates) {
	const text = read(file);
	// Relative links, ignoring URLs, anchors and ${...} placeholders.
	for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
		if (/^(https?:|mailto:|#|\$\{)/.test(target)) continue;
		const path = resolve(dirname(file), target.split("#")[0]);
		if (!existsSync(path)) report(file, `broken link to ${target}`);
	}
	// Embedded templates. With --fix, a drifted copy is rewritten from the template instead.
	// The block runs to the first fence at the start of a line, so an empty block can't swallow
	// the rest of the file. `body` is the block's lines, each ending in "\n" ("" when empty).
	const embedded = /(<!-- template: (\S+) -->\n```[^\n]*\n)((?:(?!```)[^\n]*\n)*?)(```)(?=\n|$)/g;
	const expected = (source) => {
		const content = read(source).replace(/\n$/, "");
		return content.length > 0 ? `${content}\n` : "";
	};
	let fixed = text;
	const markers = (text.match(/<!-- template: \S+ -->/g) ?? []).length;
	const matched = [...text.matchAll(embedded)];
	if (matched.length !== markers) report(file, `${markers - matched.length} template marker(s) not followed by a fenced block`);
	for (const [, , templatePath, body] of matched) {
		const source = join(templates, ...templatePath.split("/"));
		if (!existsSync(source)) {
			report(file, `embeds templates/${templatePath}, which doesn't exist`);
			continue;
		}
		if (expected(source) !== body && !FIX) {
			report(file, `embedded copy of templates/${templatePath} has drifted; run \`pnpm check --fix\``);
		}
	}
	if (FIX) {
		fixed = text.replace(embedded, (match, head, templatePath, _body, tail) => {
			const source = join(templates, ...templatePath.split("/"));
			return existsSync(source) ? head + expected(source) + tail : match;
		});
		if (fixed !== text) {
			writeFileSync(file, fixed);
			console.log(`fixed embedded templates in ${relative(ROOT, file).replaceAll("\\", "/")}`);
		}
	}
}

const summary = [];
for (const plugin of readdirSync(PLUGINS).filter((name) => statSync(join(PLUGINS, name)).isDirectory())) {
	const skillsDir = join(PLUGINS, plugin, "skills");
	const templates = join(PLUGINS, plugin, "templates");
	const skills = existsSync(skillsDir)
		? readdirSync(skillsDir).filter((name) => statSync(join(skillsDir, name)).isDirectory())
		: [];
	const own = skills.filter((name) => !existsSync(join(skillsDir, name, "VENDORED.md")));
	for (const name of own) {
		const dir = join(skillsDir, name);
		checkSkillFile(dir, name);
		checkReferences(dir);
		checkEvals(dir);
		for (const file of markdownFiles(dir)) checkMarkdown(file, templates);
	}
	// Markdown shipped in templates (CLAUDE.md, patch instructions) may embed templates too.
	if (existsSync(templates)) {
		for (const file of markdownFiles(templates)) checkMarkdown(file, templates);
	}
	summary.push(`${plugin}: ${own.length} own, ${skills.length - own.length} vendored`);
}

if (problems.length > 0) {
	console.error(problems.map((p) => `✗ ${p}`).join("\n"));
	console.error(`\n${problems.length} problem(s). ${summary.join("; ")}.`);
	process.exit(1);
}
console.log(`✓ Own skills meet the standard; embedded templates match. ${summary.join("; ")}.`);
