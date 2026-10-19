# nuvraxis-plugins

Claude Code plugins from Nuvraxis:

- **`nuvraxis-frontend`**: our production conventions for Next.js apps (TypeScript 7, Next.js 16 App Router, nuvui, Biome, SCSS + BEM, pnpm 12 + Turborepo) and the path every app takes to production: Docker → GHCR → Helm → Argo CD, driven by GitHub Actions.
- **`nuvraxis-fullstack`**: adds a PostgreSQL data layer to those apps: Drizzle ORM v1 in a `packages/db` workspace package, valibot validation at the edges, local Postgres with Docker Compose, CI against a Postgres service, and migrations as an Argo CD PreSync Job. It builds on `nuvraxis-frontend`, so install both.

## Install

In Claude Code:

```
/plugin marketplace add Nuvraxis/nuvraxis-plugins
/plugin install nuvraxis-frontend@nuvraxis-plugins
/plugin install nuvraxis-fullstack@nuvraxis-plugins
```

To share them with everyone working in a repo, install at project scope from that repo (this writes `.claude/settings.json`, which you commit):

```sh
claude plugin install nuvraxis-frontend@nuvraxis-plugins --scope project
claude plugin install nuvraxis-fullstack@nuvraxis-plugins --scope project
```

## Start an app

A frontend-only app:

```
/nuvraxis-frontend:scaffold-frontend-app my-app
```

With a database, run the frontend scaffold first, then add the data layer (the second command checks for the first, today or months later):

```
/nuvraxis-frontend:scaffold-frontend-app my-app
/nuvraxis-fullstack:scaffold-fullstack my-app
```

Plugins can't depend on each other or call each other's user-only commands, so the fullstack scaffold stops with the exact frontend command if it doesn't find a frontend scaffold (`turbo.json`, `apps/my-app/next.config.ts` with `output: "standalone"`, `charts/my-app/Chart.yaml`, `.github/workflows/pr.yaml`).

## What's inside

Claude loads a skill when the task matches its description (a `Dockerfile`, a `.scss` file, a `"use server"` action, a `drizzle.config.ts`…). You can also call one directly as `/<plugin>:<skill>`.

### `nuvraxis-frontend`

| Skill | Covers |
|---|---|
| `typescript-production` | TS 7 strict config layering, unions, branded ids, valibot at the edges, exports maps, type tests |
| `nextjs-production` | Server/Client boundaries, Cache Components (`use cache`), Server Actions, env, health route, standalone output |
| `nextjs-security` | Auth in every action and handler, cookies, nonce CSP (with nuvui's needs), headers, redirects, SSRF |
| `biome` | One root config, presets and domains, nested configs, `biome ci`, migrating off ESLint/Prettier |
| `scss-bem` | BEM naming, one block per file, nuvui tokens and mixins, stylelint rules |
| `pnpm-turborepo` | `pnpm-workspace.yaml` catalog and supply-chain settings, workspace layout, `turbo.json`, `--affected` |
| `docker-nextjs` | Five-stage Dockerfile, pinned Node 26 Alpine, verified pnpm, non-root, read-only root filesystem |
| `helm-nextjs` | One chart per app, probes, security context, ConfigMap + existing Secret, HPA/PDB, Argo CD |
| `github-actions` | `pr.yaml`, `main.yaml`, `release.yaml`, permissions, SHA-pinned actions + Dependabot, the release ritual |
| `scaffold-frontend-app` | **User-invoked only.** Creates a new repo from the templates and proves it builds |
| `nuvui` | Vendored from [Nuvraxis/nuvui](https://github.com/Nuvraxis/nuvui): the component library's own skill |
| `turborepo` | Vendored from [vercel/turborepo](https://github.com/vercel/turborepo): points Claude at the docs bundled in `turbo` |

MCP server: `nuvui` (`https://nuvui.nuvraxis.com/mcp`, no auth): rules, component pages, blocks, tokens. Check it with `/mcp`. Generated apps also get `next-devtools-mcp` in their own `.mcp.json`.

Hook: after Claude edits or writes a file, `biome check --write` runs on it with the project's own Biome, but only for files inside the project with a `biome.json` above them. Anywhere else it does nothing.

### `nuvraxis-fullstack`

| Skill | Covers |
|---|---|
| `drizzle-postgres` | Schema with `snakeCase.table`, uuid ids, timestamptz, relations v2, RQB v2 vs the select builder, transactions, `drizzle-orm/valibot`, the v1 migration flow, the pool and PgBouncer |
| `db-package` | `packages/db` boundaries, what it exports, query functions taking an `Executor`, PGlite tests, scripts |
| `postgres-ops` | Local Compose, external production database, the Secret, the Argo CD PreSync migrate Job, CI, forward-only rollback, backups |
| `scaffold-fullstack` | **User-invoked only.** Adds the database layer to a frontend scaffold and proves it end to end |
| `drizzle-kit`, `drizzle-kit-generate`, `drizzle-kit-migrations`, `drizzle-kit-hints`, `drizzle-kit-push`, `drizzle-kit-pull`, `drizzle-kit-output-modes`, `drizzle-kit-responses-and-errors` | Vendored: the official skills shipped inside `drizzle-kit@1.0.0-rc.4`, taken from its npm tarball |

No MCP server in the plugin. Generated apps list the official drizzle-kit MCP server in `.mcp.json` but disable it in `.claude/settings.json`: it can `push` and `pull` against whatever `DATABASE_URL` is set, so enable it only against a local database.

### Templates

Each plugin's `templates/` folder holds the files its scaffold applies (`__APP__` is the app name, `__SCOPE__` the workspace scope). They're the source of truth: the skills explain them, and CI fails if a file embedded in a skill drifts from its template.

## The delivery pipeline of a generated app

```
 pull request ──► pr.yaml       Biome · stylelint · typecheck · test · build (turbo --affected)
                                docker build + run read-only + /api/health · helm lint + kubeconform
                                [fullstack] db job: drizzle-kit check, bundled migrator twice
                                against Postgres 17, db tests
                                nothing is published

 merge to main ─► main.yaml     one multi-arch image, provenance + SBOM
                                → ghcr.io/nuvraxis/<app>:sha-<short>  and  :main

 tag vX.Y.Z ────► release.yaml  tag must be on main; no rebuild:
                                sha-<short> retagged → :vX.Y.Z and :latest
                                chart X.Y.Z → oci://ghcr.io/nuvraxis/charts/<app>
                                GitHub Release with the chart, image digest and SBOM

 Argo CD ───────► syncs the chart from OCI (production) or charts/<app> in git (dev)
                  [fullstack] PreSync Job migrates first; the Deployment rolls out only if it succeeds
```

Release ritual: merge to main, wait for `main.yaml` to go green, then `git tag vX.Y.Z && git push origin vX.Y.Z`.

### How migrations reach production

A migration is a folder under `packages/db/drizzle/`, generated from a schema change and committed in the same PR, where `pr.yaml` checks it and runs it twice against Postgres 17. Merging builds the app image, which carries the migrations and a bundled runner (`packages/db/dist/migrate.mjs`, with drizzle-orm and pg inside). Tagging publishes the chart for that image. When Argo CD syncs the chart, a PreSync Job runs the runner from the same image and tag as the Deployment: if every pending migration applies, the new Deployment rolls out; if one fails, the sync stops and the old pods keep serving the unchanged schema. Rollback is always a new forward migration.

## Working on this repo

Requirements: Node 24+, pnpm (any 11+; it switches to the pinned version), git, tar, and for the template checks Docker and Helm.

```sh
pnpm validate        # claude plugin validate --strict: both plugins + the marketplace
pnpm check           # own skills meet the standard; embedded templates match templates/
pnpm check --fix     # rewrite drifted embedded template copies from the templates
pnpm sync            # re-vendor nuvui, turborepo and the drizzle-kit skills, rewrite UPSTREAM.json
pnpm sync --check    # fail if any vendored copy differs from its pin (CI runs this)
```

`.github/workflows/validate.yml` runs all of the above, then scaffolds throwaway apps: a frontend app (install, typecheck, lint, build, actionlint, `helm lint --strict`, kubeconform, `docker build`, a read-only container health check), the frontend chart with the database overlay (the migrate Job must render), and a frontend + database app against a Postgres 17 service (install, lint, typecheck, test, build, `drizzle-kit check`, a no-op generate, the bundled migrator twice).

### Vendored skills

`nuvraxis-frontend/skills/nuvui` and `skills/turborepo` are copies of upstream git folders; `nuvraxis-fullstack/skills/drizzle-kit*` are the skills shipped in the `drizzle-kit` npm package, at the version `plugins/nuvraxis-fullstack/templates/pnpm-catalog.yaml` pins for generated apps, verified against the registry's integrity hash. All are pinned in `UPSTREAM.json`. Don't edit them: change the upstream (or the pinned version), run `pnpm sync`, review the diff, commit.

### Skill standard

Each own skill has a `SKILL.md` of at most 300 lines (frontmatter `name` + a `description` that names the files and dependencies that should trigger it, with no angle brackets), numbered rules with a reason and a wrong/right pair where it isn't obvious, a `## Verify` block with the exact commands, `## Sources`, longer material in `references/`, and three tasks in `evals/evals.json` in the same shape as nuvui's evals. `pnpm check` enforces the mechanical parts.

### Releasing

Users stay on the version they installed until `version` in a plugin's `.claude-plugin/plugin.json` changes. To release:

1. Bump `version` in each plugin that changed (semver: a new skill or template change is minor; a rule fix is patch; a change that breaks generated repos is major).
2. Merge to `main`.
3. `git tag vX.Y.Z && git push origin vX.Y.Z` (one tag for the marketplace).

Users update with `/plugin marketplace update nuvraxis-plugins`.

## Privacy

The plugins collect no data and contain no telemetry. Details, including what the nuvui MCP server receives: [PRIVACY.md](PRIVACY.md).

## License

MIT. The vendored skills keep their upstream licenses: nuvui and Turborepo are MIT; the drizzle-kit skills come from the `drizzle-kit` npm package, which declares MIT (the drizzle-orm repository itself is Apache-2.0).
