# Migrations with drizzle-kit v1

The commands themselves, their JSON output and rename prompts are in the vendored official skills (`drizzle-kit-migrations`, `drizzle-kit-generate`, `drizzle-kit-hints`, `drizzle-kit-responses-and-errors`). This page is how we use them.

## Layout

```
packages/db/drizzle/
└─ 20261019110459_init/
   ├─ migration.sql     # what the runner applies, statements split on --> statement-breakpoint
   └─ snapshot.json     # the schema after this migration; drizzle-kit diffs against it
```

v1 removed `meta/_journal.json`. Each folder's snapshot records the ids of the snapshots before it, which is how `check` and `generate` spot two branches that both added a migration on top of the same parent.

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
