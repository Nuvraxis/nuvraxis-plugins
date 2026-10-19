// Local development data: `pnpm db:seed`. Idempotent, so it's safe to run again: rows that
// already exist are left alone. Never run it against production.

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { relations } from "./relations";
import { users } from "./schema";

const seedUsers = [
  { email: "admin@example.com", name: "Ada Admin", role: "admin" },
  { email: "member@example.com", name: "Max Member", role: "member" },
] as const;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("seed: DATABASE_URL is not set");
  process.exit(1);
}

const pool = new Pool({ connectionString, max: 1 });
try {
  const db = drizzle({ client: pool, relations });
  const inserted = await db
    .insert(users)
    .values([...seedUsers])
    .onConflictDoNothing({ target: users.email })
    .returning({ email: users.email });
  console.log(`seed: inserted ${inserted.length} of ${seedUsers.length} users`);
} catch (error) {
  console.error(`seed: failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
