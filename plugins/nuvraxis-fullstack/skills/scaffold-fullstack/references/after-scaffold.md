# After adding the database layer

Hand these to the user as a checklist; each needs a decision or an account action.

## Before the first deploy

1. **A production database**: managed PostgreSQL 17 (or the platform team's). One database per app; this app's Argo CD Application is its only migrator.
2. **The Secret**, in the app's namespace, named `<release fullname>-db` or whatever `db.externalSecret.name` says, with one key: `DATABASE_URL=postgres://<user>:<password>@<host>:5432/<db>?sslmode=verify-full&sslrootcert=…`. Create it from your vault (External Secrets) **before** the first sync, or the migrate pod stays in `CreateContainerConfigError`.
3. **A database user for the app** that owns the schema (migrations create tables). If you separate a migration role from a runtime role later, give the Job its own Secret.
4. **Backups**: automated backups on, PITR retention set, one restore tested into a scratch instance, failure alerts routed to someone.
5. **Connection limits**: replicas × `DATABASE_POOL_MAX` (default 10) plus the migrate Job must stay under the server's `max_connections`, or put PgBouncer in front (transaction mode works; don't use named prepared statements).

## The example

`apps/<app>/src/app/users/` and `src/components/user-lookup/` exist to prove the wiring: page → Server Action → valibot schema from the table → `getUserById` → Postgres. The action has no authentication. Before shipping, add `requireSession()` + authorisation (nextjs-security), or delete both folders.

## First migration in production

1. Merge; `main.yaml` builds the image with `packages/db/dist/migrate.mjs` and `packages/db/drizzle/`.
2. Tag `vX.Y.Z`; `release.yaml` publishes chart `X.Y.Z`.
3. Point the Argo CD Application at `X.Y.Z`. The PreSync Job applies the migrations, then the Deployment rolls out.
4. Check: `kubectl -n <ns> logs job/<app>-migrate` shows `migrate: applied …`.

## Day to day

- Schema change → `pnpm db:generate` → read the SQL → commit with the code that needs it.
- Keep each migration compatible with the previous release; destructive changes take two releases.
- Never edit a committed migration, never `drizzle-kit push` anything shared.
- The drizzle-kit MCP server stays disabled unless `DATABASE_URL` points at your local database.
