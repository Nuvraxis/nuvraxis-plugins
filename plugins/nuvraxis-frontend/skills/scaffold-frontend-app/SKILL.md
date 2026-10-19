---
name: scaffold-frontend-app
description: >-
  Creates a new Nuvraxis frontend repo — pnpm + Turborepo monorepo with a Next.js 16 app, nuvui, Biome, SCSS + stylelint, a Dockerfile, a Helm chart and the pr/main/release workflows — from the plugin's tested templates, then proves it with typecheck, lint, build, docker build and helm lint.
argument-hint: <app-name>
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/copy-templates.mjs *), Bash(pnpm install*), Bash(pnpm typecheck*), Bash(pnpm lint*), Bash(pnpm build*), Bash(git init*), Bash(helm lint *)
---

# Scaffold a frontend app

Create the repo for the app named **$ARGUMENTS** from `${CLAUDE_PLUGIN_ROOT}/templates/`. The templates are the tested source of truth: copy them, don't rewrite them, and don't bump the versions they pin.

## 1. Check the name and the target

- No name given: ask for one and stop.
- The name becomes the pnpm package, the image `ghcr.io/nuvraxis/<name>`, the chart and the Kubernetes resources, so it must be lowercase letters, digits and dashes, 2–42 characters, starting with a letter. Lowercase it; if it still doesn't fit, propose a fixed name and ask.
- Target: the current directory if it's empty (a fresh `git init` or only `README.md`/`LICENSE` is fine). Otherwise ask whether to use `./<name>/` instead. Never overwrite existing files without asking; the copy script refuses unless given `--force`.

## 2. Check the tools

Run `node --version`, `pnpm --version`, `git --version`, and `docker --version` / `helm version --short` for the delivery checks. Report what's missing, then carry on with what's possible.

- Node below 26: the app targets Node 26 (`.node-version`, `engines`). Next 16 builds on Node 24 too, so local checks still run; the Docker build is the Node 26 check.
- pnpm: any pnpm 11+ works; it switches itself to the version in `packageManager`. Never install it with npm.

## 3. Copy the templates

```sh
node "${CLAUDE_SKILL_DIR}/scripts/copy-templates.mjs" <name> <target-dir>
```

It replaces `__APP__` in paths and contents and renames `gitignore`/`gitattributes` to their dotfiles. It prints every file it writes. What you get:

```
.github/workflows/{pr,main,release}.yaml   .github/dependabot.yml   .vscode/{settings,extensions}.json
.mcp.json   CLAUDE.md   biome.json   stylelint.config.mjs   turbo.json
package.json   pnpm-workspace.yaml   .node-version   .gitignore   .gitattributes   .dockerignore
packages/tsconfig/{package.json,base.json}
apps/<name>/{package.json,next.config.ts,tsconfig.json,Dockerfile,public/}
apps/<name>/src/{proxy.ts,instrumentation.ts,env.ts}
apps/<name>/src/app/{layout,page,error,not-found}.tsx, api/health/route.ts
apps/<name>/src/components/nonce-provider/   apps/<name>/src/styles/{globals.scss,abstracts,base,layout}
charts/<name>/{Chart.yaml,values.yaml,values-production.yaml,.helmignore,templates/*}
```

The app already has `output: "standalone"`, the `/api/health` route, `@nuvui/react` with its stylesheet imported in the root layout, Biome, SCSS with stylelint, the nonce CSP and OpenTelemetry. The project-scope `.mcp.json` registers the nuvui MCP and `next-devtools-mcp`.

## 4. Install

```sh
cd <target-dir>
git init        # if it isn't a repo yet; the Biome config reads .gitignore through git
pnpm install
```

If pnpm stops on `ERR_PNPM_IGNORED_BUILDS`, a dependency's install script needs a decision: tell the user which package, and add it to `allowBuilds` only after they agree (see `pnpm-turborepo`). If it refuses a version for being too new (`minimumReleaseAge`), keep the template's pinned version.

## 5. Before writing any UI

The home page is a placeholder. If the user asked for screens in the same request, call the nuvui MCP `get_rules` first, then `list_blocks` / `get_page` for what you'll use, and follow the `nuvui`, `scss-bem` and `nextjs-production` skills. Don't add UI the user didn't ask for.

## 6. Prove it

Run each and record pass/fail with the relevant output on failure:

```sh
pnpm typecheck
pnpm lint
pnpm build
docker build -f apps/<name>/Dockerfile -t <name>:local --build-arg NEXT_DEPLOYMENT_ID=local .
helm lint --strict charts/<name>
helm lint --strict charts/<name> -f charts/<name>/values-production.yaml
```

If Docker is running, also start the image the way Kubernetes will and hit the health route, then remove the container:

```sh
docker run -d --name <name>-check -p 3000:3000 --read-only \
  --tmpfs /app/apps/<name>/.next/cache:uid=1001,gid=1001 --cap-drop ALL <name>:local
curl -fsS http://127.0.0.1:3000/api/health
docker rm -f <name>-check
```

On Git Bash for Windows, prefix `docker run` with `MSYS_NO_PATHCONV=1` so `/app/...` isn't rewritten into a Windows path.

A failure in a freshly copied template is a plugin bug: report it with the output, don't patch around it silently.

## 7. Report

- What was created, and where.
- Each check from step 6 with its result.
- The next steps from [references/after-scaffold.md](references/after-scaffold.md): GitHub repo and branch protection, GHCR package access, pull credentials, Argo CD Application, the first release.

Don't commit unless the user asks. If they do, one commit: `chore: scaffold <name> from nuvraxis-frontend templates`.

## Verify

Step 6 is the verification. The scaffold is done only when every command there has passed, or its failure is reported with output.

## Sources

- `${CLAUDE_PLUGIN_ROOT}/templates/`: the files copied, kept in sync with the plugin's skills by `scripts/check-skills.mjs` in the plugin repo
- https://code.claude.com/docs/en/skills
- https://pnpm.io/cli/install
- https://nuvui.nuvraxis.com/docs/mcp
