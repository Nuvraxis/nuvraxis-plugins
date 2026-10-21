# nuvraxis-plugins

Claude Code plugins that build and maintain Next.js apps the way Nuvraxis ships them to production.

With them installed, one command creates a complete, working repository: a Next.js 16 app on the nuvui component library, in a pnpm + Turborepo monorepo, with a Dockerfile, a Helm chart and GitHub Actions that take it from pull request to Kubernetes. A second command adds a PostgreSQL database. After that, Claude follows the same conventions every time it touches the code: when you ask for a page, a Server Action, a stylesheet, a table or a migration, the matching skill loads and Claude writes it to the same rules the templates were built and tested with.

| Plugin | What it gives you |
|---|---|
| **`nuvraxis-frontend`** | The app: TypeScript 7, Next.js 16 App Router, nuvui, Biome, SCSS + BEM, pnpm 12 + Turborepo, Docker, Helm, GitHub Actions, Argo CD. 12 skills, the nuvui MCP server, and a hook that formats every file Claude edits. |
| **`nuvraxis-fullstack`** | The database: Drizzle ORM v1 and PostgreSQL 17 in a `packages/db` package, valibot validation, local Postgres with Docker Compose, a CI job against a real Postgres, and migrations run by Argo CD before each rollout. 12 skills. Builds on `nuvraxis-frontend`, so install both. |

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Create an app](#create-an-app)
- [Add a database](#add-a-database)
- [Working with Claude day to day](#working-with-claude-day-to-day)
- [What's inside](#whats-inside)
- [From pull request to production](#from-pull-request-to-production)
- [Updating and removing](#updating-and-removing)
- [Troubleshooting](#troubleshooting)
- [Working on this repo](#working-on-this-repo)

## Requirements

- **Claude Code** (CLI, desktop app or IDE extension).
- **For the generated app:** Node 26 (Node 24 is enough for local checks), pnpm 11 or newer (it switches itself to the pinned 12.14.0; never install it with npm), and git.
- **For the delivery checks:** Docker, and Helm 4. Without them the scaffold still creates the app and skips those checks.
- **For the database:** Docker, for local Postgres.

## Install

In Claude Code:

```
/plugin marketplace add Nuvraxis/nuvraxis-plugins
/plugin install nuvraxis-frontend@nuvraxis-plugins
/plugin install nuvraxis-fullstack@nuvraxis-plugins
```

Skip the last line if you don't need a database. Restart Claude Code, then check:

- `/plugin` lists both plugins as enabled.
- `/mcp` shows `nuvui` as connected. It's a public, read-only server with no sign-in.

To give everyone on a repository the same plugins, install them at project scope from inside that repository. This writes `.claude/settings.json`, which you commit:

```sh
claude plugin install nuvraxis-frontend@nuvraxis-plugins --scope project
claude plugin install nuvraxis-fullstack@nuvraxis-plugins --scope project
```

## Create an app

Open Claude Code in an empty folder (a fresh `git init` is fine) and run:

```
/nuvraxis-frontend:scaffold-frontend-app my-app
```

The name becomes the package, the image (`ghcr.io/nuvraxis/my-app`), the chart and the Kubernetes resources, so use lowercase letters, digits and dashes. If the folder isn't empty, Claude offers `./my-app/` instead and never overwrites files without asking.

Claude then:

1. Checks your tools (Node, pnpm, git, Docker, Helm) and says what's missing.
2. Copies the templates, printing every file it writes.
3. Runs `pnpm install`.
4. Proves the app works: typecheck, lint, build, `docker build`, the container started read-only and answering on `/api/health`, `helm lint --strict` and kubeconform.
5. Reports each check with its result, and what to do next.

It takes a few minutes. You end up with:

```
my-app/
├─ apps/my-app/            Next.js 16 app: nuvui, nonce CSP, /api/health, OpenTelemetry, Dockerfile
├─ packages/tsconfig/      shared strict TypeScript config
├─ charts/my-app/          Helm chart for Argo CD
├─ .github/workflows/      pr.yaml, main.yaml, release.yaml (actions pinned by SHA) + Dependabot
├─ CLAUDE.md               the project's rules, read by Claude in every session
├─ .mcp.json               nuvui and next-devtools MCP servers
├─ biome.json  stylelint.config.mjs  turbo.json  pnpm-workspace.yaml  package.json
```

Run it:

```sh
pnpm dev                                   # http://localhost:3000
pnpm typecheck && pnpm lint && pnpm build  # what CI runs on every pull request
```

The home page is a placeholder. Ask Claude for the screens you need (see [below](#working-with-claude-day-to-day)). Nothing is committed for you; commit when you're happy with it.

## Add a database

In the same repository, today or months after the frontend scaffold:

```
/nuvraxis-fullstack:scaffold-fullstack my-app
```

It first checks that the frontend scaffold is there (`turbo.json`, `apps/my-app/next.config.ts` with `output: "standalone"`, `charts/my-app/Chart.yaml`, `.github/workflows/pr.yaml`). If it isn't, Claude stops and tells you to run the frontend command first. Plugins can't call each other's commands, so this is the one step you do by hand.

Then it adds:

- **`packages/db/`**: the schema (an example `users` table), query functions with tests on in-memory Postgres (PGlite), valibot schemas, the first migration, and a bundled migration runner.
- **`compose.yaml` and `.env.example`**: local PostgreSQL 17, plus Adminer with `docker compose --profile tools up`.
- **Root scripts**: `pnpm db:generate`, `db:check`, `db:migrate`, `db:seed`, `db:studio`.
- **The chart**: a migrate Job that Argo CD runs before each rollout (PreSync), and the database Secret wired into the Deployment.
- **CI**: a `db` job in `pr.yaml` that checks the migrations and runs them twice against a real Postgres 17.
- **An example** at `/users`: a form → Server Action → validation → query → Postgres. It has no authentication; secure it or delete it before you ship.

Claude proves it the same way: starts Postgres, migrates twice, then runs typecheck, lint, tests, build, `docker build` and the Helm checks. Before the first production deploy, read the checklist it gives you. The important item is creating the database Secret **before** the first Argo CD sync, or the migrate pod waits in `CreateContainerConfigError`.

## Working with Claude day to day

You don't call the skills yourself. Ask for what you want in plain words, and Claude loads the skill whose description matches the files and the task:

| You ask | Skill that loads |
|---|---|
| "Add an invoices page with a table of open invoices" | `nextjs-production`, `nuvui`, `scss-bem` |
| "Cache this and refresh it when an invoice is paid" | `nextjs-production` |
| "Protect this action so only admins can run it" | `nextjs-security` |
| "Add a `due_date` column and a migration" | `drizzle-postgres`, `drizzle-kit-generate` |
| "Where should this query go? How do I test it?" | `db-package` |
| "Add a CI check" / "The release failed" | `github-actions` |
| "Expose it on a domain" / "Add autoscaling" | `helm-nextjs` |
| "The image is too big" | `docker-nextjs` |
| "Add a shared package" / "Why isn't turbo caching?" | `pnpm-turborepo` |

You can also call any skill by name, as `/nuvraxis-frontend:nextjs-security`, to have it review what's there.

Three things happen without asking:

- **Claude reads nuvui before writing UI.** Before the first line of a page, component or stylesheet, it reads the library through the nuvui MCP server: the rules, what changed since your installed version, the components across every package, the blocks and charts to start from, the guides, the full page of each component it will use, and the design tokens. If the server isn't reachable, it reads the copy of nuvui's docs bundled in the plugin and tells you, since that copy can lag behind the latest release.
- **Every file Claude edits is formatted.** A hook runs `biome check --write` on it with the project's own Biome. It only acts inside a project with a `biome.json`, so it does nothing in your other repositories.
- **Claude checks its work.** Each skill ends with the commands that prove a change, and the generated `CLAUDE.md` says to run `pnpm typecheck && pnpm lint && pnpm build` before calling anything done.

## What's inside

### `nuvraxis-frontend`

| Skill | Covers |
|---|---|
| `scaffold-frontend-app` | **You run it.** Creates a new repository from the templates and proves it builds |
| `nextjs-production` | Server/Client boundaries, Cache Components (`use cache`), Server Actions, env, health route, standalone output, and the read-nuvui-first checklist |
| `nextjs-security` | Auth in every action and route handler, cookies, nonce CSP (with nuvui's needs), headers, redirects, SSRF |
| `typescript-production` | Strict TS 7 config, unions, branded ids, valibot at the edges, exports maps, type tests |
| `scss-bem` | BEM naming, one block per file, nuvui tokens and mixins, stylelint |
| `biome` | One root config, presets and domains, nested configs, `biome ci`, moving off ESLint and Prettier |
| `pnpm-turborepo` | The workspace catalog and supply-chain settings, workspace layout, `turbo.json`, `--affected` |
| `docker-nextjs` | Five-stage Dockerfile, pinned Node 26 Alpine, verified pnpm, non-root, read-only root filesystem |
| `helm-nextjs` | One chart per app, probes, security context, ConfigMap and Secret, HPA, PDB, Argo CD |
| `github-actions` | `pr.yaml`, `main.yaml`, `release.yaml`, minimal permissions, SHA-pinned actions with Dependabot, releasing |
| `nuvui` | From [Nuvraxis/nuvui](https://github.com/Nuvraxis/nuvui): the component library's own skill |
| `turborepo` | From [vercel/turborepo](https://github.com/vercel/turborepo): points Claude at the docs bundled in `turbo` |

MCP server: `nuvui` at `https://nuvui.nuvraxis.com/mcp` (rules, component pages, blocks, charts, guides, tokens, changes). Generated apps also get `next-devtools-mcp` in their own `.mcp.json`.

### `nuvraxis-fullstack`

| Skill | Covers |
|---|---|
| `scaffold-fullstack` | **You run it.** Adds the database layer to a frontend scaffold and proves it end to end |
| `drizzle-postgres` | Schema with `snakeCase.table`, uuid ids, timestamptz, relations v2, relational queries vs the select builder, transactions, `drizzle-orm/valibot`, the migration flow, the pool and PgBouncer |
| `db-package` | What `packages/db` exports and never exports, query functions that work inside transactions, PGlite tests, scripts |
| `postgres-ops` | Local Compose, the production database and its Secret, the Argo CD migrate Job, CI, forward-only rollback, backups |
| `drizzle-kit`, `drizzle-kit-generate`, `drizzle-kit-migrations`, `drizzle-kit-hints`, `drizzle-kit-push`, `drizzle-kit-pull`, `drizzle-kit-output-modes`, `drizzle-kit-responses-and-errors` | The official skills shipped inside `drizzle-kit@1.0.0-rc.4`, the same version generated apps install |

No MCP server in this plugin. Generated apps list the official drizzle-kit MCP server in `.mcp.json` but switch it off in `.claude/settings.json`: it can `push` and `pull` against whatever `DATABASE_URL` points at, so turn it on only against a local database.

### Templates

Each plugin's `templates/` folder holds the files its scaffold copies (`__APP__` is the app name, `__SCOPE__` the workspace scope). They're the source of truth: the skills explain them, CI builds them on every change, and CI fails if code quoted in a skill drifts from its template.

## From pull request to production

```
 pull request ──► pr.yaml       Biome · stylelint · typecheck · test · build (turbo --affected)
                                docker build + run read-only + /api/health · helm lint + kubeconform
                                [fullstack] db job: drizzle-kit check, migrations twice
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

To release an app: merge to `main`, wait for `main.yaml` to go green, then `git tag vX.Y.Z && git push origin vX.Y.Z`.

### How migrations reach production

1. You change the schema and run `pnpm db:generate`. Read the SQL and commit it with the code that needs it.
2. `pr.yaml` checks the migration and runs it twice against Postgres 17.
3. Merging builds the image, which carries the migrations and the bundled runner.
4. Tagging publishes the chart for that image.
5. When Argo CD syncs, a PreSync Job runs the runner from the same image. If every migration applies, the new Deployment rolls out. If one fails, the sync stops and the old pods keep serving the unchanged schema.

Rollback is always a new forward migration.

## Updating and removing

You stay on the version you installed until you update:

```
/plugin marketplace update nuvraxis-plugins
```

Updating the plugins doesn't change repositories you've already generated: they keep the files and versions they were created with. Skills apply to the code as it is.

To remove: `/plugin uninstall nuvraxis-fullstack@nuvraxis-plugins` and `/plugin uninstall nuvraxis-frontend@nuvraxis-plugins`.

## Troubleshooting

| Symptom | Fix |
|---|---|
| The scaffold commands don't appear | Run `/plugin` to check both plugins are enabled, then restart Claude Code. |
| `/mcp` shows `nuvui` as failed | Check that you can reach `https://nuvui.nuvraxis.com`. Claude falls back to the bundled docs meanwhile. |
| `scaffold-fullstack` stops straight away | It didn't find a frontend scaffold. Run `/nuvraxis-frontend:scaffold-frontend-app my-app` first, in the same folder. |
| Port 5432 is already in use | Start Postgres on another port, `POSTGRES_PORT=55432 docker compose up -d`, and use the same port in `.env`. |
| `pnpm install` stops with `ERR_PNPM_IGNORED_BUILDS` | A dependency wants to run an install script. Claude names it; add it to `allowBuilds` in `pnpm-workspace.yaml` only if you trust it. |
| pnpm refuses a version as too new | `minimumReleaseAge` holds back releases less than a day old. Keep the pinned version. |
| The migrate pod is stuck in `CreateContainerConfigError` | The database Secret doesn't exist yet. Create it in the app's namespace, then sync again. |
| `docker run` paths break in Git Bash on Windows | Prefix the command with `MSYS_NO_PATHCONV=1`. |

## Working on this repo

Requirements: Node 24+, pnpm 11+, git and tar; Docker and Helm for the template checks.

```sh
pnpm validate        # claude plugin validate --strict: both plugins + the marketplace
pnpm check           # own skills meet the standard; code quoted from templates matches
pnpm check --fix     # rewrite drifted quotes from the templates
pnpm sync            # re-copy nuvui, turborepo and the drizzle-kit skills, rewrite UPSTREAM.json
pnpm sync --check    # fail if any copied skill differs from its pin (CI runs this)
```

`.github/workflows/validate.yml` runs all of the above, then scaffolds throwaway apps and builds them: a frontend app (install, typecheck, lint, build, actionlint, Helm checks, `docker build`, a read-only container health check), the chart with the database overlay, and a frontend + database app against a Postgres 17 service (tests, build, `drizzle-kit check`, migrations twice).

### Copied skills

`nuvui` and `turborepo` are copies of folders in their upstream repositories. The `drizzle-kit*` skills come from the `drizzle-kit` npm package, at the version `plugins/nuvraxis-fullstack/templates/pnpm-catalog.yaml` pins for generated apps, checked against the registry's integrity hash. All are pinned in `UPSTREAM.json`. Don't edit them: change the upstream or the pinned version, run `pnpm sync`, review the diff, commit.

### Skill standard

Each own skill has a `SKILL.md` of at most 300 lines: frontmatter with `name` and a `description` that names the files and dependencies that should load it (no angle brackets); numbered rules with a reason, and a wrong/right pair where it isn't obvious; `## Verify` with the exact commands; `## Sources`; longer material in `references/`; and three tasks in `evals/evals.json`. `pnpm check` enforces the mechanical parts.

### Releasing the plugins

1. Bump `version` in `.claude-plugin/plugin.json` of each plugin that changed (a new skill or template change is minor, a rule fix is patch, a change that breaks generated repositories is major).
2. Merge to `main`.
3. `git tag vX.Y.Z && git push origin vX.Y.Z` (one tag for the marketplace).

## Privacy

The plugins collect no data and contain no telemetry. Details, including what the nuvui MCP server receives: [PRIVACY.md](PRIVACY.md).

## License

MIT. The copied skills keep their upstream licenses: nuvui and Turborepo are MIT; the drizzle-kit skills come from the `drizzle-kit` npm package, which declares MIT (the drizzle-orm repository itself is Apache-2.0).
