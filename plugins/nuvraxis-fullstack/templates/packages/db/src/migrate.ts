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
