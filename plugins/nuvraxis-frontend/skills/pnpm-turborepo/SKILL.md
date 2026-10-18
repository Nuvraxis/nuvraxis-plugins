---
name: pnpm-turborepo
description: >-
  Nuvraxis monorepo conventions on pnpm 12 and Turborepo 2.11 — packageManager pin without Corepack, pnpm-workspace.yaml as the only config (catalog, allowBuilds, minimumReleaseAge, trustPolicy), apps/* and packages/* layout with @repo/* source-only packages, workspace:* links, turbo.json tasks (inputs, outputs, env, dependsOn), --affected in CI, remote cache, turbo prune for Docker, and versioning. Use when the repo has pnpm-workspace.yaml, turbo.json, pnpm-lock.yaml, or "packageManager": "pnpm@…", or when adding a dependency, a workspace package, or a turbo task.
when_to_use: >-
  "add a dependency", "create a shared package", "set up the monorepo", "why is turbo not caching", "upgrade next", "pnpm install fails with ignored builds", "add a script", "only build what changed".
---

# pnpm + Turborepo

Use for anything about the workspace itself. Turborepo engine details (every `turbo.json` key, filters, caching internals) are in the vendored `turborepo` skill, which points at the docs shipped inside the installed `turbo`; read those rather than guessing. This skill covers how we use both.

The template's root `package.json`, `pnpm-workspace.yaml` and `turbo.json` are the source of truth.

## Rules

1. **Pin pnpm exactly in `packageManager`; no Corepack.**
   `"packageManager": "pnpm@12.14.0"`. pnpm 12 reads it and downloads that version when a different one is running (`pmOnFail: download` is the default), and records it in the lockfile. Don't add `corepack enable` anywhere, don't install pnpm with npm. The Dockerfile's `PNPM_VERSION` and CI's `pnpm/action-setup` follow the same field; bump all three together.

2. **All pnpm settings live in `pnpm-workspace.yaml`.** pnpm 11+ reads only auth and registry settings from `.npmrc`; everything else (`catalog`, `allowBuilds`, `minimumReleaseAge`, `audit`) goes in the workspace file. Environment overrides use `pnpm_config_*`, not `npm_config_*`.

3. **Every external dependency comes from the `catalog:`.**
   ```yaml
   # pnpm-workspace.yaml
   catalog:
     next: 16.4.2
     valibot: 1.5.0
   ```
   ```json
   // apps/web/package.json
   "dependencies": { "next": "catalog:", "valibot": "catalog:" }
   ```
   Exact versions, so an upgrade is one reviewed line and every package moves together. The exception is `turbo`, pinned in the root `package.json` because the Dockerfile reads it from there.

4. **Install scripts are denied unless listed in `allowBuilds`.**
   pnpm 12 fails the install (`ERR_PNPM_IGNORED_BUILDS`) when a dependency wants to run a script that isn't reviewed (`strictDepBuilds` is on by default). Read the package's script, then add `name: true` to run it or `name: false` to skip it. Prebuilt binaries (sharp, Biome, turbo, TypeScript 7) don't need scripts; the template sets `"@parcel/watcher": false` (an optional watcher pulled in by `sass`). Never set `dangerouslyAllowAllBuilds`.

5. **Keep the supply-chain gates: `minimumReleaseAge: 1440`, `trustPolicy: no-downgrade`.**
   A version must be a day old before it installs, and a release that lost the provenance its predecessor had is refused. For an urgent security fix that's younger than a day, add it to `minimumReleaseAgeExclude` (`"pkg@1.2.3"`) in the same PR and remove it after. Don't lower the age globally. `pnpm dlx` obeys both too.

6. **Layout: `apps/*` deploy, `packages/*` are shared, internal names are `@repo/*`.**
   ```
   apps/<app>/              Next.js app (Dockerfile, its own package.json)
   packages/tsconfig/       @repo/tsconfig: base.json (in the template)
   packages/ui/             @repo/ui: app-specific compositions of nuvui (only when 2+ apps share them)
   packages/types/          @repo/types: domain types shared by apps and the API client
   packages/api-client/     @repo/api-client: typed client for the backend
   charts/<app>/            Helm chart (not a workspace package)
   ```
   Create a package when a second consumer exists, not before. `@repo/ui` composes nuvui components into product pieces; it never re-exports or restyles nuvui wholesale. No `@repo/biome-config`: the root `biome.json` plus `"extends": "//"` covers nested needs.

7. **Internal packages are source-only and linked with `workspace:*`.**
   `"@repo/types": "workspace:*"`, and the package exports `./src/index.ts` (see `typescript-production` rule 12). No build step means no stale `dist/` and nothing to cache.

8. **Root scripts call turbo; package scripts do the work.**
   Root: `build`, `dev`, `typecheck`, `test` → `turbo run <task>`; `lint`/`lint:fix`/`format` run Biome and stylelint once over the whole repo (faster than per package). Package: `build`, `dev`, `typecheck`, `test` with the real commands. Run one package with `pnpm --filter <name> <script>` or `pnpm exec turbo run build --filter=<name>`; never `cd apps/x && …` in scripts.

9. **Every turbo task declares `outputs` and the `env` that changes its output.**
   ```json
   "build": {
     "dependsOn": ["^build"],
     "outputs": [".next/**", "!.next/cache/**", "dist/**"],
     "env": ["NEXT_PUBLIC_*", "NEXT_DEPLOYMENT_ID", "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY"],
     "passThroughEnv": ["NEXT_TELEMETRY_DISABLED"]
   }
   ```
   Turbo runs tasks in strict env mode: a variable not listed isn't passed to the task at all. List build-time variables in `env` (they become part of the cache key). Runtime-only variables (`DATABASE_URL`, `API_BASE_URL`) are read by the running server, so they never belong in `turbo.json`. Details: [references/turbo.md](references/turbo.md).

10. **CI runs `turbo run … --affected` with full history.**
    `--affected` compares against the PR's base branch (Turbo reads `GITHUB_BASE_REF`). A shallow clone makes every package look changed, so checkout uses `fetch-depth: 0` with `filter: blob:none` (history without file contents). main.yaml and release.yaml don't use `--affected`: they build the one app image.

11. **Remote cache is optional and off by default.** Turn it on by setting `TURBO_TOKEN` (secret) and `TURBO_TEAM` (variable) in the repo and passing them to the job's `env`. Docker builds never use it; they cache layers through BuildKit instead.

12. **Docker builds start from `turbo prune <app> --docker`.** It writes `out/json/` (manifests), `out/full/` (sources) and `out/pnpm-lock.yaml`, containing only the app and the workspace packages it depends on. Loose root files aren't included, which is why the shared tsconfig is a package. `--scope` no longer exists; the app name is positional. The full Dockerfile is in `docker-nextjs`.

13. **Apps are versioned by git tag; no changesets.**
    The release tag `vX.Y.Z` is the app version and `gh release create --generate-notes` writes the notes (see `github-actions`). Internal packages are private and unversioned (`0.0.0`). If a package is ever published, use pnpm's built-in change intents (`pnpm change`, `pnpm change check` in CI, `pnpm version -r`; changesets-compatible files in `.changeset/`) instead of adding the changesets CLI.

14. **Adding or upgrading a dependency:**
    1. Add or change the version in `catalog:`.
    2. Reference it as `"catalog:"` in the package(s) that use it.
    3. `pnpm install` (the lockfile updates; review new `allowBuilds` prompts).
    4. Run the Verify block. Commit `pnpm-workspace.yaml`, `package.json` files and `pnpm-lock.yaml` together.
    `pnpm outdated -r` lists stale packages and stale GitHub Actions versions.

15. **Commands that changed in pnpm 12:** `pnpm --silent <script>` (not `-s`); `--no-frozen-lockfile` (not `--frozen-lockfile false`); `pnpm dlx` is also `pnx`. `pnpm fetch` + `pnpm install --offline --frozen-lockfile` still work for Docker.

## Verify

```sh
pnpm install --frozen-lockfile    # lockfile matches manifests, no unreviewed build scripts
pnpm typecheck && pnpm lint && pnpm build
pnpm exec turbo run build --dry   # tasks, hashes and cache status, without running
docker build -f apps/<app>/Dockerfile -t <app> .   # exercises turbo prune + a frozen offline install
```

## Sources

- https://pnpm.io/settings
- https://pnpm.io/catalogs
- https://pnpm.io/settings/build
- https://pnpm.io/supply-chain-security
- https://pnpm.io/blog/2026/08/10/whats-different-in-pnpm-12
- https://pnpm.io/versioning
- https://pnpm.io/cli/fetch
- https://turborepo.dev/docs/reference/configuration
- https://turborepo.dev/docs/crafting-your-repository/using-environment-variables
- https://turborepo.dev/docs/reference/run#--affected
- https://turborepo.dev/docs/reference/prune
- https://turborepo.dev/docs/core-concepts/internal-packages
