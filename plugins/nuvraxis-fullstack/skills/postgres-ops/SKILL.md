---
name: postgres-ops
description: >-
  Operating PostgreSQL for Nuvraxis apps — local Postgres 17 with Docker Compose (pinned by digest, loopback only, named volume, healthcheck), .env.example with DATABASE_URL only, an external production database the chart never deploys, DATABASE_URL from an existing Kubernetes Secret, migrations as an Argo CD PreSync Job running the bundled migrator from the app image, the PR CI job against a Postgres service, the optional drizzle-kit MCP server, backups, and forward-only rollback. Use when the repo has compose.yaml, migrate-job.yaml, values with a db section, a DATABASE_URL variable, or when asked to run, connect, deploy or migrate the database.
when_to_use: >-
  "start the database locally", "port 5432 is taken", "the migration job failed", "migrate pod stuck", "deploy the database", "add the database secret", "how do migrations reach production", "roll back a migration", "enable the drizzle MCP", "connect to RDS/Cloud SQL".
---

# Postgres operations

Use for everything around the database rather than in it: running it locally, getting credentials to the app, and applying migrations in CI and Kubernetes. Schema and queries are `drizzle-postgres`; the package layout is `db-package`; the chart itself is `nuvraxis-frontend:helm-nextjs`, and this overlay follows its rules.

## Rules

1. **Local Postgres is `compose.yaml`: Postgres 17 pinned by digest, loopback only, named volume, healthcheck.**
   `docker compose up -d --wait`, `cp .env.example .env`, `pnpm db:migrate`, `pnpm db:seed`. The port binds to `127.0.0.1`, never `0.0.0.0`: a dev database with a known password must not be reachable from the network. Port taken by another Postgres? `POSTGRES_PORT=55432 docker compose up -d` and use that port in `.env`. Adminer is behind the `tools` profile. Template: [references/local.md](references/local.md).

2. **`.env.example` holds `DATABASE_URL` and nothing else secret; `.env` is never committed.** The example's password only opens the local container. Real credentials never appear in a file in the repo, in `values*.yaml`, in a workflow or in an image.

3. **The production database is external; the chart never deploys Postgres.** Managed Postgres (RDS, Cloud SQL, Azure, Neon, Crunchy…) or a platform team's cluster. No StatefulSet, no Bitnami subchart, no `postgres` container in the app chart: a database's lifecycle (upgrades, backups, failover) is not an app release.

4. **`DATABASE_URL` comes from an existing Secret, referenced by name.**
   `db.externalSecret.name` (empty means `<release fullname>-db`) is loaded with `envFrom` by both the Deployment and the migrate Job. The chart never templates its value. Create it with External Secrets, Sealed Secrets or `kubectl create secret generic … --from-literal=DATABASE_URL=…` from a vault, never from a committed file.

5. **TLS to the database is in the URL: `sslmode=verify-full&sslrootcert=/path/ca.pem`.** Mount the CA as a volume from a ConfigMap or Secret if the provider's CA isn't in the image's trust store. Don't also pass an `ssl` object to the pool; the URL wins. `sslmode=require` in `pg` currently means verify-full too, with a warning; say what you mean.

6. **Migrations run as an Argo CD PreSync Job from the same image and tag as the Deployment.**
   `argocd.argoproj.io/hook: PreSync`, `argocd.argoproj.io/hook-delete-policy: BeforeHookCreation`, a fixed name (`<fullname>-migrate`), command `node packages/db/dist/migrate.mjs`, `parallelism: 1`, `completions: 1`, `backoffLimit: 1`, `activeDeadlineSeconds: 600`, the app's pod and container `securityContext`, `restartPolicy: Never`. If it fails, the sync fails and the old pods keep serving. Full Job and values: [references/argocd-migrations.md](references/argocd-migrations.md).

7. **No `ttlSecondsAfterFinished` on the Job.** Argo CD warns it leaves the app OutOfSync when the Job disappears under it. `BeforeHookCreation` deletes the previous Job at the next sync instead, which keeps the last run's logs until then.

8. **The Job's pod must not carry the app's selector labels.** It gets `app.kubernetes.io/name: <name>-migrate`. A pod without ports or probes is Ready as soon as it runs, and with the app's labels the Service would send it traffic and the PDB would count it.

9. **One database belongs to exactly one Argo CD Application.** Drizzle's migrator takes no lock, so two Applications (or two apps) migrating the same database can run concurrently and corrupt the migrations table. One schema owner per database; other services read through it or get their own database.

10. **The Secret must exist before the first sync.** The PreSync Job runs before anything else in the chart is created. Missing Secret → the migrate pod sits in `CreateContainerConfigError` and the sync never starts. The chart's NOTES.txt says this too.

11. **PR CI runs the exact artefact the Job runs, against a real Postgres 17.**
    `pr.yaml`'s `db` job: a `postgres:17` service (same digest as Compose), `drizzle-kit check`, `turbo run build --filter=@repo/db`, then `node packages/db/dist/migrate.mjs` twice (the second must print "database is up to date"), then the db tests. `drizzle-kit migrate` and `push` never run in CI.

12. **`release.yaml` is unchanged.** Migrations are an Argo CD concern: they run when the chart version that contains them is synced, not when the tag is pushed.

13. **Rollback is forward.** A bad migration is fixed by a new migration, never by `drop` or by editing history. Keep every migration backward-compatible with the previous app version (the old pods serve during the rollout); destructive changes take two releases. Rolling back the app (an older chart) leaves the schema as it is, which is why the schema must stay compatible.

14. **Backups and point-in-time recovery are the database provider's job.** Before go-live, verify: automated backups are on, PITR retention covers your recovery objective, a restore has actually been tested into a scratch instance, and someone gets alerted when backups fail.

15. **The drizzle-kit MCP server is listed in `.mcp.json` but disabled in `.claude/settings.json`.** Its tools include `push` and `pull`, which act on whatever `DATABASE_URL` is set. Enable it (remove `drizzle` from `disabledMcpjsonServers`, or toggle it in `/mcp`) only while `DATABASE_URL` points at a local database, and disable it again before pointing at anything shared.

## Verify

```sh
docker compose up -d --wait && pnpm db:migrate && pnpm db:migrate   # second run: up to date
helm template <app> charts/<app> -f charts/<app>/values-production.yaml | grep -A3 "argocd.argoproj.io/hook"
helm lint --strict charts/<app> -f charts/<app>/values-production.yaml
docker build -f apps/<app>/Dockerfile -t <app>:local . && \
  docker run --rm -e DATABASE_URL=<local url via host.docker.internal> <app>:local node packages/db/dist/migrate.mjs
docker compose down
```

## Sources

- https://argo-cd.readthedocs.io/en/stable/user-guide/sync-waves/
- https://argo-cd.readthedocs.io/en/stable/user-guide/helm/
- https://kubernetes.io/docs/concepts/workloads/controllers/job/
- https://kubernetes.io/docs/concepts/configuration/secret/
- https://hub.docker.com/_/postgres
- https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/
- https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers
- https://node-postgres.com/features/ssl
- https://orm.drizzle.team/docs/pg/drizzle-kit-migrate
- https://code.claude.com/docs/en/mcp
