# __APP__

Next.js 16 app in a pnpm + Turborepo monorepo, built on nuvui, shipped as a Docker image and a Helm chart. Conventions come from the `nuvraxis-frontend` plugin; its skills have the full rules.

## Ground rules

- **pnpm only.** Never write `npm`, `npx` or `yarn` in a file, script or command. Use `pnpm`, `pnpm dlx`, `pnpm exec`. Add dependencies to the workspace `catalog:` in `pnpm-workspace.yaml` and reference them as `"catalog:"`.
- **Node 26**, the exact version in `.node-version`. The Dockerfile base and CI use the same version.
- **Biome formats and lints** everything except SCSS. Don't add ESLint or Prettier. A plugin hook runs `biome check --write` on each file Claude edits.
- **SCSS is BEM + nuvui tokens, linted by stylelint.** One block per file beside its component, global (not `.module.scss`), `@use` never `@import`, every color a token, no `!important`, never select a `nuv-` class.
- **This app uses nuvui. Read it before writing any UI** (see below). Change a component's look by prop → `--nuv-*` variable → token. Blocks: `pnpm dlx shadcn@latest add https://nuvui.nuvraxis.com/r/<name>.json`.
- **Server Components by default.** `"use client"` only on the leaf that needs state, effects or handlers.
- **Every Server Action and route handler** authenticates, validates input with valibot, and authorises against the resource itself.
- **Config:** `NEXT_PUBLIC_*` is baked in at build and identical in every environment. Everything per-environment is a runtime env var read on the server through `src/env.ts`.

## Before writing any UI: read nuvui first

Never write nuvui code from memory. Before the first line of a page, component or stylesheet, read the library through the nuvui MCP (`.mcp.json`), passing the `@nuvui/react` version from `apps/__APP__/package.json` as `version`:

1. `get_rules`, then `get_rules` with each topic the work touches.
2. `get_changes` with the installed `@nuvui/*` versions.
3. `list_components` across every package, add-ons included.
4. `list_blocks`, and `list_charts` for any chart; `get_block` / `get_chart` for one that fits, and start from it.
5. `list_guides`, and `get_page` for each guide that applies.
6. `get_page` for every component you'll use, the whole page; `search_docs` for anything you can't place.
7. `get_tokens` before writing any CSS value.

If the MCP isn't connected, read the same from the `nuvraxis-frontend:nuvui` skill and say so.

## Commands

```sh
pnpm dev            # turbo run dev
pnpm typecheck      # next typegen && tsc --noEmit, per package
pnpm lint           # biome check . && stylelint "**/*.scss"
pnpm lint:fix
pnpm build          # turbo run build
docker build -f apps/__APP__/Dockerfile -t __APP__ .     # from the repo root
helm lint --strict charts/__APP__
```

Run `pnpm typecheck && pnpm lint && pnpm build` before calling a change done.

## Layout

```
apps/__APP__/            Next.js app: src/app, src/components/<block>/, src/styles, src/proxy.ts
apps/__APP__/Dockerfile  standalone image; build context is the repo root
packages/tsconfig/       shared tsconfig (base.json)
charts/__APP__/          Helm chart, one per app
.github/workflows/       pr.yaml, main.yaml, release.yaml
```

## Delivery

PR → `pr.yaml` checks (Biome, stylelint, typecheck, build, Docker build + health check, helm lint + kubeconform). Nothing is published.
Merge to `main` → `main.yaml` builds the image once (amd64 + arm64) and pushes `ghcr.io/nuvraxis/__APP__:sha-<short-sha>` and `:main`.
Tag `vX.Y.Z` → `release.yaml` retags that commit's image as `:vX.Y.Z` and `:latest` (no rebuild), pushes the chart to `oci://ghcr.io/nuvraxis/charts/__APP__` at `X.Y.Z`, and creates the GitHub Release.
Argo CD syncs the chart from the OCI registry (production) or from `charts/__APP__` in git.

Release ritual: merge to main → wait for `main.yaml` to go green → `git tag vX.Y.Z && git push origin vX.Y.Z`. Never edit `version`/`appVersion` in `Chart.yaml`; the release sets them.

## Which skill applies

| Working on | Skill |
|---|---|
| `.ts`/`.tsx` types, tsconfig, validation | `nuvraxis-frontend:typescript-production` |
| Pages, data, caching, actions, env | `nuvraxis-frontend:nextjs-production` |
| Auth, cookies, CSP, headers, redirects | `nuvraxis-frontend:nextjs-security` |
| `biome.json`, lint/format errors | `nuvraxis-frontend:biome` |
| `.scss` | `nuvraxis-frontend:scss-bem` |
| Workspace, catalog, `turbo.json` | `nuvraxis-frontend:pnpm-turborepo` (engine details: `turborepo`) |
| `Dockerfile`, `.dockerignore` | `nuvraxis-frontend:docker-nextjs` |
| `charts/` | `nuvraxis-frontend:helm-nextjs` |
| `.github/workflows/` | `nuvraxis-frontend:github-actions` |
| nuvui components, theming, blocks | `nuvraxis-frontend:nuvui` |
