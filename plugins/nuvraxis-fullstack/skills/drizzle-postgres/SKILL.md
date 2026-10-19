---
name: drizzle-postgres
description: >-
  Drizzle ORM v1 (1.0.0-rc.4) rules for PostgreSQL 17 in Nuvraxis apps — schema files with snakeCase.table, uuid ids, timestamptz columns, pgEnum vs text, indexes and foreign keys, relations v2 with defineRelations, relational queries with object filters vs the select builder, transactions and savepoints, valibot schemas from drizzle-orm/valibot at the edges, the generate/review/commit migration flow, drizzle.config.ts, the node-postgres Pool and PgBouncer. Use when the project has drizzle.config.ts, drizzle-orm or drizzle-kit in package.json, imports from drizzle-orm/pg-core, or a drizzle/ migrations folder.
when_to_use: >-
  "add a table", "add a column", "write a query", "join these", "add a relation", "wrap this in a transaction", "validate before insert", "create a migration", "the migration conflicts", "connection pool", edits under packages/db/src/.
---

# Drizzle + PostgreSQL

Use for anything that touches the schema, queries or migrations in `packages/db`. How the package is laid out and what it exports is `db-package`; local Postgres, CI and the Argo CD migration Job are `postgres-ops`. drizzle-kit's own commands, output and errors are covered by the vendored official skills (`drizzle-kit`, `drizzle-kit-generate`, `drizzle-kit-migrations`, `drizzle-kit-hints`, …): read those rather than guessing flags.

Baseline: `drizzle-orm` and `drizzle-kit` **1.0.0-rc.4**, pinned exactly in the workspace catalog (v1 is still a release candidate; `latest` on npm is the 0.x line, whose APIs differ). `pg` 8.23.1. PostgreSQL 17.

## Rules

1. **One table per file in `src/schema/`, re-exported from `src/schema/index.ts`, declared with `snakeCase.table`.**
   TypeScript keys stay camelCase and SQL columns become snake_case, so each name is written once. The v0 `casing` option on `drizzle()` is gone in v1.
   ```ts
   // Wrong: the name twice, and drift waiting to happen
   export const users = pgTable("users", { createdAt: timestamp("created_at") });

   // Right
   export const users = snakeCase.table("users", { createdAt: timestamp({ withTimezone: true }) });
   ```

2. **Primary keys are `uuid().primaryKey().defaultRandom()`.**
   Ids end up in URLs, logs and other services. A random uuid doesn't reveal how many rows exist, can't be guessed by incrementing, and any service can mint one without a round trip. A bigint identity (`integer().primaryKey().generatedAlwaysAsIdentity()`) is smaller and faster to index; use it for internal join tables and high-volume rows that never leave the database.

3. **Timestamps are `timestamp({ withTimezone: true, mode: "date" })`, `notNull`, `defaultNow()`; `updatedAt` adds `.$onUpdate(() => new Date())`.** Without a time zone, Postgres stores wall-clock time and every reader has to guess which zone it was.

4. **Columns are `notNull()` unless absence means something.** A nullable column is a third state every reader has to handle; make it deliberate.

5. **`text` over `varchar(n)`; a length limit belongs in validation unless the database must enforce it.** In Postgres they perform the same, and changing `varchar(n)` needs a migration.

6. **`pgEnum` for closed sets that rarely change; `text` plus a TypeScript union for sets that will grow.** Adding an enum value is a migration and can't run inside some transactions; a text column with app-level validation changes with a deploy.

7. **`jsonb` columns are typed: `jsonb().$type<Preferences>()`.** Untyped json is `unknown` everywhere it's read. Validate it at the edge like any other input.

8. **Indexes and constraints live in the table callback, as an array; every foreign key states `onDelete`.**
   ```ts
   export const posts = snakeCase.table(
     "posts",
     {
       id: uuid().primaryKey().defaultRandom(),
       authorId: uuid().notNull().references(() => users.id, { onDelete: "cascade" }),
       createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
     },
     (t) => [index("posts_author_id_idx").on(t.authorId), index("posts_created_at_idx").on(t.createdAt)],
   );
   ```
   Name indexes yourself (`<table>_<columns>_idx`, `<table>_<column>_key` for unique) so migrations stay readable. Index every foreign key column you filter or join on; Postgres doesn't do it for you.

9. **Relations are defined once, in `src/relations.ts`, with `defineRelations` (relations v2).**
   ```ts
   export const relations = defineRelations(schema, (r) => ({
     users: { posts: r.many.posts() },
     posts: { author: r.one.users({ from: r.posts.authorId, to: r.users.id, optional: false }) },
   }));
   ```
   Pass them as `drizzle({ client: pool, relations })`. The v1 `relations()` helper (now only in `drizzle-orm/_relations`) and `db._query` are not used.

10. **Relational queries (`db.query.*`) for reads that return nested data; the select builder for joins, aggregates and `groupBy`.**
    RQB v2 filters are objects: `findMany({ where: { role: "admin", createdAt: { gte: since } }, with: { posts: { limit: 5 } }, orderBy: { createdAt: "desc" }, limit: 20 })`. Raw fragments inside RQB use the callback form, ``RAW: (t) => sql`lower(${t.email}) = ${email}` ``: referencing the imported table there produces the wrong alias. Details: [references/rqb-v2.md](references/rqb-v2.md).

11. **Every write that the caller needs back uses `.returning()`; every list has a `limit`; hot paths select named columns.** `select()` with no column list fetches every column, including the jsonb blob nobody reads. `.findFirst()` adds `limit 1` itself.

12. **Raw SQL only through the `sql` template; never string concatenation.** ``sql`… ${value}` `` sends `value` as a bound parameter. `sql.raw()` is for identifiers you control, never for input.

13. **Multi-table writes go in `db.transaction(async (tx) => …)`, and nothing slow happens inside.**
    A nested `tx.transaction()` is a savepoint; `tx.rollback()` throws to abort. HTTP calls, queue publishes and emails go after the transaction commits (or into an outbox table written inside it), never inside the callback, where they hold a connection and row locks while waiting.

14. **Validate at the edge with schemas derived from the table: `drizzle-orm/valibot`.**
    `createInsertSchema(users, { email: (s) => v.pipe(s, v.trim(), v.toLowerCase(), v.email()) })`, then `v.pick(…, ["email", "name"])` per use case, so a form can't set `role` or `id`. Never pass `FormData` or a raw request body to `insert`. valibot, not zod, matches the frontend plugin. More: [references/valibot-edges.md](references/valibot-edges.md).

15. **Migrations: `pnpm db:generate` → read the SQL → commit → the bundled runner applies it.**
    - Generate with `TZ=UTC` (drizzle-kit names folders by local time today).
    - Never edit a committed migration; add a new one. Never delete one.
    - `drizzle-kit push` is for a throwaway local database only: never in CI, never against a shared or production database.
    - `drizzle-kit check` runs in PR CI and fails on migrations that conflict across branches.
    - Old layouts (`meta/_journal.json`) are converted once with `drizzle-kit up`; the v1 runtime migrator refuses them.
    - A rename shows up as drop + create unless you answer drizzle-kit's prompt: see the vendored `drizzle-kit-hints` skill.
    Full flow: [references/migrations-v1.md](references/migrations-v1.md).

16. **`drizzle.config.ts`: `dialect: "postgresql"`, `schema`, `out`, `dbCredentials.url` from the environment, `verbose: true`.** It loads the repo root `.env` locally when `DATABASE_URL` isn't set. v1 no longer documents `strict` (push confirms by default), so the template leaves it out. Casing is handled by `snakeCase.table`, not by the config.

17. **One `Pool` per process, sized per pod, created without connecting, kept on `globalThis` in development.**
    `max` 5–10 per pod (replicas × max must stay under the server's or PgBouncer's limit). `src/client.ts` starts with `import "server-only"`. TLS comes from the URL (`sslmode=verify-full&sslrootcert=…`): a URL `sslmode` overrides an `ssl` object passed to the pool, so set it in one place. Behind PgBouncer in transaction mode, don't call `.prepare("name")`: drizzle's node-postgres driver only sends a statement name when you give one.

18. **Performance tools:** `.prepare()` (unnamed) for queries run constantly with different parameters; ``db.execute(sql`explain analyze …`)`` to read a plan; `.$dynamic()` to add clauses conditionally; Drizzle Studio (`pnpm db:studio`) against local databases only.

## Verify

```sh
pnpm db:check                     # migrations consistent, no cross-branch conflicts
TZ=UTC pnpm db:generate           # "No schema changes" unless you meant to change the schema
pnpm --filter @repo/db typecheck
pnpm --filter @repo/db test       # PGlite, migrations applied fresh
pnpm db:migrate                   # bundled runner against the local database (docker compose up -d)
```

## Sources

- https://orm.drizzle.team/llms-full.txt (the v1 docs as one file; the per-page sources follow)
- https://orm.drizzle.team/docs/pg/v0-v1-changes
- https://orm.drizzle.team/docs/pg/upgrade-v1
- https://orm.drizzle.team/docs/pg/sql-schema-declaration
- https://orm.drizzle.team/docs/pg/column-types
- https://orm.drizzle.team/docs/pg/indexes-constraints
- https://orm.drizzle.team/docs/pg/relations-v1-v2
- https://orm.drizzle.team/docs/pg/rqb
- https://orm.drizzle.team/docs/pg/select
- https://orm.drizzle.team/docs/pg/transactions
- https://orm.drizzle.team/docs/pg/valibot
- https://orm.drizzle.team/docs/pg/drizzle-config-file
- https://orm.drizzle.team/docs/pg/drizzle-kit-generate
- https://orm.drizzle.team/docs/pg/drizzle-kit-check
- https://orm.drizzle.team/docs/pg/drizzle-kit-up
- https://orm.drizzle.team/docs/pg/perf-queries
- https://node-postgres.com/apis/pool
- https://www.pgbouncer.org/config.html
