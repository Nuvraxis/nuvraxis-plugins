
## Database (nuvraxis-fullstack)

PostgreSQL through Drizzle ORM v1, in `packages/db` (`@__SCOPE__/db`). Rules: the `nuvraxis-fullstack` skills `drizzle-postgres`, `db-package` and `postgres-ops`; drizzle-kit itself: the vendored `drizzle-kit*` skills.

- `packages/db` is the only package that imports `drizzle-orm` or `pg`. Apps import `db`, types and query functions from `@__SCOPE__/db`.
- Schema change: edit `packages/db/src/schema/`, then `pnpm db:generate`, read the SQL, commit it. Never edit a committed migration; add a new one. Never `drizzle-kit push` outside a throwaway local database.
- Validate input with the valibot schemas from `@__SCOPE__/db` before any insert; never pass `FormData` to a query.
- Local database: `docker compose up -d`, `cp .env.example .env`, `pnpm db:migrate`, `pnpm db:seed`.
- Never commit `.env` or any `DATABASE_URL` with real credentials. In Kubernetes it comes from an existing Secret, and the chart only references it by name.
- Migrations reach production as an Argo CD PreSync Job running `node packages/db/dist/migrate.mjs` from the app image.
- The drizzle-kit MCP server is in `.mcp.json` but disabled in `.claude/settings.json`: it can `push` and `pull` against whatever `DATABASE_URL` is set. Enable it only while that points at a local database.

```sh
pnpm db:generate   # new migration from the schema diff
pnpm db:check      # migration conflicts across branches
pnpm db:migrate    # build + apply with the bundled runner
pnpm db:seed       # idempotent local data
pnpm db:studio     # local inspection only
```
