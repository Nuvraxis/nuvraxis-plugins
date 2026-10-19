import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { relations } from "./relations";

// One pool per server process. `next dev` re-runs modules on every edit; keeping the pool on
// globalThis stops each reload from opening a new one. Production gets a fresh process anyway.
const globalForDb = globalThis as typeof globalThis & { __appDbPool?: Pool };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  return new Pool({
    // TLS settings belong in the URL (sslmode=verify-full&sslrootcert=…). A sslmode in the URL
    // overrides any `ssl` option passed here, so don't pass one.
    ...(connectionString ? { connectionString } : {}),
    // Per pod. Replicas × max must stay under the database's (or PgBouncer's) connection limit.
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

// Creating the pool opens no connection, so importing this during `next build` is harmless.
const pool = globalForDb.__appDbPool ?? createPool();
if (process.env.NODE_ENV !== "production") globalForDb.__appDbPool = pool;

export const db = drizzle({ client: pool, relations });
export type Db = typeof db;
