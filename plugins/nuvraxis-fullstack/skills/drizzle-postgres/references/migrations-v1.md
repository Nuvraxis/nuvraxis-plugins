# Migrations with drizzle-kit v1

The commands themselves, their JSON output and rename prompts are in the vendored official `drizzle-kit` skill (`migrations.md`, `generate.md`, `hints.md`, `responses-and-errors.md`). This page is how we use them.

## Layout

```
packages/db/drizzle/
└─ 20261019110459_init/
   ├─ migration.sql     # what the runner applies, statements split on --> statement-breakpoint
   └─ snapshot.json     # the full schema in the first folder, the change after that
```

v1 removed `meta/_journal.json`. Since rc.5 snapshots are incremental: the first folder's is a `base` snapshot with the whole schema, and each later one is a small `diff`. Each records the ids of the snapshots before it and what its statements touch, which is how `check` and `generate` tell whether two branches that both added a migration on the same parent conflict.

## The flow

1. Change the schema in `src/schema/`.
2. `TZ=UTC pnpm db:generate` (or `--name <what>` via `pnpm --filter @repo/db exec drizzle-kit generate --name add_posts`). drizzle-kit names the folder from the current time in the machine's zone; UTC keeps names ordered across a team.
3. **Read `migration.sql`.** Look for drops you didn't intend (a rename without a hint is drop + create), `NOT NULL` added to a table with rows (needs a default or a backfill), and new indexes on big tables (consider `CREATE INDEX CONCURRENTLY` in a hand-written migration).
4. Commit the folder with the schema change, in the same PR.
5. CI (`pr.yaml`, `db` job): `drizzle-kit check`, then the bundled `dist/migrate.mjs` twice against Postgres 17, then tests.
6. After merge and release, Argo CD's PreSync Job applies it before the new pods start (see `postgres-ops`).

## Rules

- **Never edit or delete a committed migration.** Databases that applied it won't apply it again; the next one must fix forward.
- **Rollback is a new migration.** Never `drop` your way back in production; write the forward change that restores the old shape (and keep the data).
- **Backward-compatible steps across deploys.** The old pods run while the migration applies and until the rollout finishes, so a migration must work with the previous app version: add a column (nullable or with a default) → deploy code that writes it → backfill → make it `NOT NULL` in a later migration. Renames and drops take two releases.
- **`push` only for a throwaway local database** (prototyping a schema before generating). It writes no migration, so nothing reaches CI or production.
- **Conflicts:** when `check` reports non-commutative migrations, rebase onto `main`, delete your branch's uncommitted migration folder, and `generate` again so it sits on top.
- **Old layout:** a repo with `meta/_journal.json` runs `drizzle-kit up` once; the v1 runtime migrator throws on the old layout.
- **Custom SQL** (data backfills, `CONCURRENTLY` indexes): `drizzle-kit generate --custom --name <what>` creates an empty migration to fill in. Keep data changes idempotent.

## Upgrading an app from rc.4 to rc.5

An app scaffolded before rc.5 keeps working on rc.4 until you move it. To move it:

1. Set `drizzle-orm` and `drizzle-kit` to `1.0.0-rc.5` in the `pnpm-workspace.yaml` catalog, then `pnpm install`.
2. `pnpm --filter @repo/db exec drizzle-kit up`, once. It rewrites each `snapshot.json` to the new format and leaves every `migration.sql` and migration id alone. Until then, `db:generate` and `db:check` stop with "please run drizzle-kit up".
3. `pnpm db:check`, then `pnpm db:generate`, which must print "No schema changes". Commit the rewritten snapshots.
4. Fix what the type checker and tests find, then search `packages/db` for: optional values in `where` (they now throw), `{}` relation filters that meant "has any" (now `true`), raw SQL that names a relation's alias, and code that read parameters from `DrizzleQueryError`. The full list is in the [release notes](https://github.com/drizzle-team/drizzle-orm/releases/tag/v1.0.0-rc.5).

Databases need nothing. The runner reads the same `drizzle.__drizzle_migrations` table, so a database migrated with rc.4 reports "database is up to date" under rc.5, and only new migrations apply.

## The runtime migrator

`src/migrate.ts`, bundled by `pnpm build` into `dist/migrate.mjs` with drizzle-orm and pg inside:

<!-- template: packages/db/src/migrate.ts -->
```ts
// The migration runner the Kubernetes Job executes: `node packages/db/dist/migrate.mjs`.
// `pnpm build` bundles this file with drizzle-orm and pg into dist/migrate.mjs, because the
// Next.js standalone image doesn't contain drizzle-orm's migrator. It needs only that file,
// the drizzle/ folder beside dist/, and DATABASE_URL.

import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Resolved from this file, never from the working directory: dist/migrate.mjs → ../drizzle.
const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

type Db = ReturnType<typeof drizzle>;

async function appliedMigrations(db: Db): Promise<string[]> {
  try {
    const result = await db.execute<{ name: string }>(
      sql`select name from drizzle.__drizzle_migrations order by id`,
    );
    return result.rows.map((row) => row.name);
  } catch {
    return []; // First run: the migrations table doesn't exist yet.
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const pool = new Pool({ connectionString, max: 1 });
  try {
    const db = drizzle({ client: pool });
    const before = new Set(await appliedMigrations(db));
    await migrate(db, { migrationsFolder });
    const applied = (await appliedMigrations(db)).filter((name) => !before.has(name));
    if (applied.length === 0) console.log("migrate: database is up to date");
    for (const name of applied) console.log(`migrate: applied ${name}`);
  } finally {
    await pool.end();
  }
}

// The underlying reason (connection refused, auth failed, SQL error) is usually the cause.
function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? ` (cause: ${error.cause.message})` : "";
  return `${error.message.split("\n")[0]}${cause}`;
}

try {
  await main();
} catch (error) {
  console.error(`migrate: failed: ${describe(error)}`);
  process.exitCode = 1;
}
```

It reads only `drizzle/*/migration.sql`, applies every folder missing from `drizzle.__drizzle_migrations` inside one transaction, and takes no lock: one runner at a time (the Job has `parallelism: 1`).
