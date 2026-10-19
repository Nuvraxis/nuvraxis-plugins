import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { relations } from "../relations";

// A fresh in-process Postgres (PGlite 0.4.x is Postgres 17) with every committed migration
// applied. One per test file: nothing to start, nothing to clean up, no Docker.
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle({ client, relations });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
  return db;
}
