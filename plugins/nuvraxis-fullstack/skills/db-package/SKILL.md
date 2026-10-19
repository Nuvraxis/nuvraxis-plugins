---
name: db-package
description: >-
  Layout and boundaries of the packages/db workspace package in Nuvraxis monorepos — the only package that imports drizzle-orm or pg; what it exports (db, inferred types, query functions, valibot schemas) and never exports (the pool, tables, drizzle-kit); query functions in src/queries taking an Executor so they compose inside transactions; no business rules; the exports map with a ./schema subpath; tsconfig with isolatedDeclarations off as a named exception; db:* scripts; the esbuild build of migrate and seed; PGlite tests under turbo; an idempotent seed. Use when creating or changing anything under packages/db/, importing the database from an app, or adding a query function or test.
when_to_use: >-
  "add a query function", "use the database from the app", "where should this query go", "test this query", "seed data", "why can't I import the pool", "add a db script", edits to packages/db/package.json or its tsconfig.
---

# The `packages/db` package

Use for how the database code is organised and consumed. What goes inside a schema file or a query is `drizzle-postgres`; running Postgres, CI and the migration Job are `postgres-ops`. The template's `packages/db/` is the source of truth; its full file list and the reasons are in [references/layout.md](references/layout.md).

## Rules

1. **`packages/db` is the only workspace package that imports `drizzle-orm` or `pg`.**
   Apps import `@repo/db` (the workspace scope the frontend chose). A second package with its own Pool means two pools per pod and queries outside the tested query layer.

2. **The public surface is `src/index.ts`: `db`, inferred types, query functions and validation schemas. Never the pool, never the tables, never drizzle-kit.**
   ```ts
   // apps/web/src/app/users/actions.ts
   // Wrong
   import { users } from "@repo/db/schema";
   await db.select().from(users).where(eq(users.id, id));

   // Right
   import { db, getUserById } from "@repo/db";
   await getUserById(db, id);
   ```
   Types are re-exported by name (`User`, `NewUser`, `UserRole` from `typeof users.$inferSelect` / `$inferInsert`), so apps never need the table to type a prop.

3. **The `./schema` export exists for drizzle-kit, not for apps.**
   `"exports": { ".": "./src/index.ts", "./schema": "./src/schema/index.ts" }`. Source-only: no build of the library itself, no `dist/` for consumers (the app's Next build compiles it). `dist/` holds only the bundled `migrate.mjs` and `seed.mjs`.

4. **Query functions live in `src/queries/<table>.ts` and take an `Executor` first.**
   `Executor` is `PgAsyncDatabase<PgQueryResultHKT, typeof relations>`: the app's `db`, a transaction's `tx`, and the PGlite test database all fit it. So one function works everywhere and composes:
   ```ts
   await db.transaction(async (tx) => {
     const result = await createUser(tx, input);
     if (!result.ok) tx.rollback();
     await addToDefaultTeam(tx, result.user.id);
   });
   ```

5. **No business rules in `packages/db`.** A query function says what to read or write, not who may do it or why. Authorisation, workflows and domain decisions live in the app's server code (or a domain package that imports nothing from Drizzle) and call the query functions. Expected failures (`email-taken`, `not-found`) are returned as results; bugs throw.

6. **`src/client.ts` is `server-only`; `migrate.ts`, `seed.ts` and tests never import it.** `server-only` throws outside a React server context, which is what keeps the pool out of client bundles; the scripts and tests build their own pool or PGlite instance instead.

7. **`isolatedDeclarations` is off in this package, by name: it's an exception, not an oversight.**
   Every `pgTable`, `pgEnum`, `defineRelations` result and `createInsertSchema` output has an inferred type that can't reasonably be written by hand, and TypeScript rejects each one under `isolatedDeclarations`. `declaration` and `declarationMap` stay on, so editors and consumers still get precise types. Don't "fix" it by annotating tables with `any`.

8. **Imports inside the package are extensionless relative paths** (`./schema`), like every other workspace package (`moduleResolution: "bundler"`). The scripts are bundled by esbuild, so nothing runs a `.ts` file under plain Node.

9. **Scripts are fixed; root forwards them.**
   | Script | Does |
   |---|---|
   | `build` | esbuild bundles `src/migrate.ts` and `src/seed.ts` to `dist/*.mjs` (drizzle-orm + pg inside, `pg-native` external, a `createRequire` banner for pg's CommonJS) |
   | `typecheck` | `tsc --noEmit` |
   | `test` | `vitest run` (PGlite) |
   | `db:generate` / `db:check` / `db:studio` | drizzle-kit |
   | `db:migrate` / `db:seed` | build, then run the bundle with the repo root `.env` loaded |
   The root `package.json` has `db:*` scripts that run `pnpm --filter @repo/db <script>`.

10. **Tests use PGlite: one fresh, migrated database per test file, one test per query function.**
    `src/testing/pglite.ts` creates a PGlite instance (0.4.x is Postgres 17), applies every committed migration, and returns a drizzle database with the same relations. No Docker, ~2 s per run, works on Windows. Test the query's contract (what comes back, what's refused), including inside a transaction. The CI `db` job additionally runs the bundled migrator against a real Postgres 17.

11. **Turbo: `build` outputs `dist/**`, `test` declares `DATABASE_URL` in `env`.** PGlite tests don't read it, but any test that does must be re-run when it changes; declaring it keeps the cache honest.

12. **The seed is idempotent and local-only.** `onConflictDoNothing({ target })` on a natural key, so a second run inserts nothing. It never runs in CI against shared databases or in the cluster.

13. **Adding a table means four places:** `src/schema/<table>.ts` (+ re-export), `src/relations.ts`, `src/queries/<table>.ts` (+ tests), then export the query functions and types from `src/index.ts`. Generate the migration in the same PR.

## Verify

```sh
pnpm --filter @repo/db typecheck
pnpm --filter @repo/db test
pnpm --filter @repo/db build && ls packages/db/dist        # migrate.mjs, seed.mjs
pnpm typecheck && pnpm build                                # the app compiles against the package
```

## Sources

- https://orm.drizzle.team/docs/pg/connect-pglite
- https://pglite.dev/docs/
- https://orm.drizzle.team/docs/pg/transactions
- https://esbuild.github.io/api/#bundle
- https://esbuild.github.io/api/#banner
- https://www.typescriptlang.org/tsconfig/#isolatedDeclarations
- https://nodejs.org/api/packages.html#subpath-exports
- https://vitest.dev/guide/
- https://www.npmjs.com/package/server-only
