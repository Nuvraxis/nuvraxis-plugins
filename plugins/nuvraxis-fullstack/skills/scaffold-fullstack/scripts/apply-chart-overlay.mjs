#!/usr/bin/env node
// Merges the plugin's charts-overlay into an app's Helm chart (charts/<app>/):
//   - adds templates/migrate-job.yaml and templates/_db-helpers.tpl
//   - appends values.db.yaml to values.yaml under a `db:` key (frontend values untouched)
//   - adds the database Secret to the Deployment's envFrom
//   - appends the database notes to NOTES.txt
//
//   node apply-chart-overlay.mjs <app-name> <repo-dir>
//
// Used by the fullstack scaffold and by the plugin repo's CI. Idempotent: a second run
// changes nothing. Exits non-zero, changing nothing, if the chart isn't the frontend's.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OVERLAY = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "templates", "charts-overlay");

// The block the frontend chart's deployment.yaml has for its own Secret; the database Secret
// is added right after it.
const ENVFROM_ANCHOR = `            {{- with .Values.existingSecret }}
            - secretRef:
                name: {{ . }}
            {{- end }}
`;

const read = (file) => readFileSync(file, "utf8").replaceAll("\r\n", "\n");

export function applyChartOverlay(app, repoDir) {
	const chart = join(resolve(repoDir), "charts", app);
	const required = ["Chart.yaml", "values.yaml", "templates/deployment.yaml", "templates/NOTES.txt"];
	const missing = required.filter((file) => !existsSync(join(chart, file)));
	if (missing.length > 0) {
		throw new Error(`charts/${app} isn't a nuvraxis-frontend chart (missing ${missing.join(", ")})`);
	}

	const deploymentFile = join(chart, "templates", "deployment.yaml");
	const deployment = read(deploymentFile);
	const needsEnvFrom = !deployment.includes("app.dbSecretName");
	if (needsEnvFrom && !deployment.includes(ENVFROM_ANCHOR)) {
		throw new Error(`charts/${app}/templates/deployment.yaml: the existingSecret envFrom block wasn't found; merge deployment-envfrom.yaml by hand`);
	}

	const changed = [];
	const replace = (text) => text.replaceAll("__APP__", app);

	for (const file of readdirSync(join(OVERLAY, "templates"))) {
		const target = join(chart, "templates", file);
		const content = replace(read(join(OVERLAY, "templates", file)));
		if (existsSync(target)) {
			if (read(target) !== content) throw new Error(`charts/${app}/templates/${file} exists and differs; not overwriting it`);
			continue;
		}
		writeFileSync(target, content);
		changed.push(`charts/${app}/templates/${file}`);
	}

	const valuesFile = join(chart, "values.yaml");
	const values = read(valuesFile);
	if (!/^db:/m.test(values)) {
		const dbValues = replace(read(join(OVERLAY, "values.db.yaml")))
			.split("\n")
			.map((line) => (line.length > 0 ? `  ${line}` : line))
			.join("\n");
		writeFileSync(valuesFile, `${values.replace(/\n*$/, "\n")}\n# Added by nuvraxis-fullstack.\ndb:\n${dbValues.replace(/\n*$/, "\n")}`);
		changed.push(`charts/${app}/values.yaml (db:)`);
	}

	if (needsEnvFrom) {
		const snippet = read(join(OVERLAY, "deployment-envfrom.yaml"));
		writeFileSync(deploymentFile, deployment.replace(ENVFROM_ANCHOR, ENVFROM_ANCHOR + snippet));
		changed.push(`charts/${app}/templates/deployment.yaml (envFrom)`);
	}

	const notesFile = join(chart, "templates", "NOTES.txt");
	const notes = read(notesFile);
	if (!notes.includes("-migrate")) {
		writeFileSync(notesFile, notes.replace(/\n*$/, "\n") + read(join(OVERLAY, "NOTES.db.txt")));
		changed.push(`charts/${app}/templates/NOTES.txt`);
	}

	return changed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [app, repoDir] = process.argv.slice(2);
	if (!app || !repoDir) {
		console.error("usage: node apply-chart-overlay.mjs <app-name> <repo-dir>");
		process.exit(2);
	}
	try {
		const changed = applyChartOverlay(app, repoDir);
		console.log(changed.length > 0 ? changed.join("\n") : "chart already has the database overlay");
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	}
}
