---
name: scaffold-fullstack
description: >-
  Adds the PostgreSQL data layer (Drizzle ORM v1 in packages/db, local Postgres, the migrate Job, CI) to a repo created by nuvraxis-frontend's scaffold, from this plugin's tested templates, then proves it with migrations, tests, a build, a Docker image and the Helm chart.
argument-hint: <app-name>
disable-model-invocation: true
allowed-tools: Bash(node ${CLAUDE_SKILL_DIR}/scripts/apply-fullstack.mjs *), Bash(node ${CLAUDE_SKILL_DIR}/scripts/apply-chart-overlay.mjs *), Bash(pnpm install*), Bash(pnpm exec biome check --write*), Bash(pnpm typecheck*), Bash(pnpm lint*), Bash(pnpm test*), Bash(pnpm build*), Bash(pnpm db:*), Bash(docker compose *), Bash(helm lint *), Bash(helm template *)
---

# Add the database layer

Add PostgreSQL to the app named **$ARGUMENTS**, from `${CLAUDE_PLUGIN_ROOT}/templates/`. The templates are tested together with nuvraxis-frontend's: copy them with the script, don't rewrite them, and keep the versions they pin.

## 1. Check that a frontend scaffold exists

This plugin builds on nuvraxis-frontend, and Claude can't start its user-only scaffold for you. Run the precheck, which works whether the frontend was scaffolded a minute or a month ago:

```sh
node "${CLAUDE_SKILL_DIR}/scripts/apply-fullstack.mjs" <app> <repo-dir> --check
```

It requires `turbo.json`, `apps/<app>/next.config.ts` with `output: "standalone"`, `charts/<app>/Chart.yaml` and `.github/workflows/pr.yaml`, and prints the workspace scope it detected. If anything is missing (exit 3), tell the user exactly this and **stop**:

```
Run /nuvraxis-frontend:scaffold-frontend-app <app> first, then this command again.
If nuvraxis-frontend isn't installed: /plugin install nuvraxis-frontend@nuvraxis-plugins
```

No name given: ask for it and stop. `packages/db` already exists (exit 1): the layer was added before; say so and stop.

## 2. Apply the layer

```sh
node "${CLAUDE_SKILL_DIR}/scripts/apply-fullstack.mjs" <app> <repo-dir>
```

It prints every file it creates or changes, and never overwrites a file it didn't create:

| Step | Result |
|---|---|
| `packages/db/` | schema (`users`), relations, client, query functions + PGlite tests, valibot schemas, bundled migrate/seed, initial migration |
| `pnpm-workspace.yaml` | catalog entries (drizzle-orm/kit 1.0.0-rc.4, pg, PGlite, vitest, esbuild) and `allowBuilds: esbuild: true` |
| `apps/<app>/package.json` | depends on `@<scope>/db` |
| root `package.json` | `db:generate`, `db:check`, `db:migrate`, `db:seed`, `db:studio` |
| `turbo.json` | `test` declares `DATABASE_URL` |
| `compose.yaml`, `.env.example` | local Postgres 17 |
| `CLAUDE.md` | a Database section |
| `apps/<app>/Dockerfile` | two `COPY` lines in the runner (`Dockerfile.patch.md`) |
| `charts/<app>/` | migrate Job (Argo CD PreSync), `db:` values, Deployment `envFrom`, NOTES |
| `.github/workflows/pr.yaml` | a `db` job (Postgres service, check, bundled migrator twice, tests) |
| `.mcp.json`, `.claude/settings.json` | the drizzle-kit MCP server, disabled |
| `apps/<app>/src/app/users/`, `src/components/user-lookup/` | the example: page → Server Action → valibot schema → `getUserById` |

## 3. Install and format

```sh
pnpm install
pnpm exec biome check --write .
```

The script writes JSON with `JSON.stringify`; Biome then formats it the way the rest of the repo is formatted. If pnpm stops on a build script other than esbuild's, tell the user which package and add it to `allowBuilds` only after they agree.

## 4. Prove it

Record each result; on failure, show the relevant output.

```sh
docker compose up -d --wait            # port 5432 taken? POSTGRES_PORT=55432 and edit .env
cp .env.example .env                   # if .env doesn't exist
pnpm db:generate                       # must print "No schema changes"
pnpm db:migrate                        # applies the initial migration
pnpm db:migrate                        # must print "database is up to date"
pnpm typecheck && pnpm lint && pnpm test && pnpm build
docker build -f apps/<app>/Dockerfile -t <app>:local --build-arg NEXT_DEPLOYMENT_ID=local .
helm lint --strict charts/<app> -f charts/<app>/values-production.yaml
helm template <app> charts/<app> -f charts/<app>/values-production.yaml   # the migrate Job must render
docker compose down
```

Optionally prove the image's own migrator against a fresh local database with `docker run --rm -e DATABASE_URL=<url via host.docker.internal> <app>:local node packages/db/dist/migrate.mjs`. On Git Bash for Windows, prefix `docker run` with `MSYS_NO_PATHCONV=1`.

A failure in freshly applied templates is a plugin bug: report it with the output, don't patch around it silently.

## 5. Report

- The files the script listed.
- Each check from step 4 and its result.
- That the `/users` example action has no authentication: secure it (nextjs-security) or delete it before shipping.
- Next steps from [references/after-scaffold.md](references/after-scaffold.md): the database Secret, Argo CD, first migration in production.

Don't commit unless asked. If asked: one commit, `feat: add PostgreSQL data layer (nuvraxis-fullstack)`.

## Verify

Step 4 is the verification. The layer is done only when every command there has passed, or its failure is reported with output.

## Sources

- `${CLAUDE_PLUGIN_ROOT}/templates/`: the files applied, checked against the skills by `scripts/check-skills.mjs` in the plugin repo, and scaffolded end to end by its CI
- https://code.claude.com/docs/en/skills
- https://orm.drizzle.team/docs/pg/get-started-postgresql
- https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/
