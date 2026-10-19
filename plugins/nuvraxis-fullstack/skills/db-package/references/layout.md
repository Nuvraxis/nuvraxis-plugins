# packages/db, file by file

```
packages/db/
├─ package.json            exports ".", "./schema"; db:* scripts; esbuild build
├─ tsconfig.json           extends @repo/tsconfig/base.json; isolatedDeclarations off (rule 7)
├─ biome.json              extends "//"; ignores drizzle/; console allowed in migrate/seed
├─ drizzle.config.ts       drizzle-kit config; loads ../../.env locally
├─ drizzle/<ts>_<name>/    migration.sql + snapshot.json per migration (committed)
└─ src/
   ├─ index.ts             the public surface
   ├─ client.ts            server-only: Pool + drizzle({ client, relations })
   ├─ executor.ts          the Executor type query functions take
   ├─ relations.ts         defineRelations (v2)
   ├─ schema/              one file per table + index.ts
   ├─ queries/             one file per table, with *.test.ts beside it
   ├─ validation/          valibot schemas derived from tables, with tests
   ├─ testing/pglite.ts    fresh migrated PGlite database for tests
   ├─ migrate.ts           the Job's runner (bundled to dist/migrate.mjs)
   └─ seed.ts              idempotent local data (bundled to dist/seed.mjs)
```

## package.json

<!-- template: packages/db/package.json -->
```json
{
  "name": "@__SCOPE__/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./schema": "./src/schema/index.ts"
  },
  "scripts": {
    "build": "esbuild src/migrate.ts src/seed.ts --bundle --platform=node --format=esm --target=node26 --outdir=dist --out-extension:.js=.mjs --external:pg-native --banner:js=\"import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);\"",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "db:generate": "drizzle-kit generate",
    "db:check": "drizzle-kit check",
    "db:migrate": "pnpm run build && node --env-file-if-exists=../../.env dist/migrate.mjs",
    "db:seed": "pnpm run build && node --env-file-if-exists=../../.env dist/seed.mjs",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "drizzle-orm": "catalog:",
    "pg": "catalog:",
    "server-only": "catalog:",
    "valibot": "catalog:"
  },
  "devDependencies": {
    "@__SCOPE__/tsconfig": "workspace:*",
    "@electric-sql/pglite": "catalog:",
    "@types/node": "catalog:",
    "@types/pg": "catalog:",
    "drizzle-kit": "catalog:",
    "esbuild": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

`@__SCOPE__` is replaced by the workspace scope at scaffold time (`repo` by default). Versions come from the workspace catalog; the fullstack scaffold adds these entries:

<!-- template: pnpm-catalog.yaml -->
```yaml
# Merged into the app's pnpm-workspace.yaml by /nuvraxis-fullstack:scaffold-fullstack:
# the catalog entries are added under `catalog:`, the allowBuilds entries under `allowBuilds:`.
#
# drizzle-kit's version here also selects the official drizzle-kit skills this plugin vendors
# (scripts/sync-upstream.mjs reads it), so the two can't drift apart. Change it here, then run
# `pnpm sync` in the plugin repository.
catalog:
  "@electric-sql/pglite": 0.4.6
  "@types/pg": 8.23.1
  drizzle-kit: 1.0.0-rc.4
  drizzle-orm: 1.0.0-rc.4
  esbuild: 0.28.2
  pg: 8.23.1
  vitest: 5.0.5

allowBuilds:
  # esbuild's install script links its platform binary; drizzle-kit and the migrate bundle need it.
  esbuild: true
```

## tsconfig.json

<!-- template: packages/db/tsconfig.json -->
```json
{
  "extends": "@__SCOPE__/tsconfig/base.json",
  "compilerOptions": {
    "lib": ["esnext"],
    "types": ["node"],
    "declaration": true,
    "declarationMap": true,
    "isolatedDeclarations": false
  },
  "include": ["src", "drizzle.config.ts"]
}
```

## The public surface

<!-- template: packages/db/src/index.ts -->
```ts
// The package's public surface for apps: the database, inferred types, query functions and
// validation schemas. Never the pool, never drizzle-kit, and not the tables: queries live in
// this package. drizzle-kit reads the tables through the "./schema" export instead.

export { type Db, db } from "./client";
export type { Executor } from "./executor";
export {
  type CreateUserResult,
  createUser,
  getUserById,
  listUsers,
  type UserSummary,
} from "./queries/users";
export type { NewUser, User, UserRole } from "./schema/users";
export {
  NewUserInput,
  UserLookupInput,
  userInsertSchema,
  userSelectSchema,
} from "./validation/users";
```

## The client

<!-- template: packages/db/src/client.ts -->
```ts
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
```

## The Executor

<!-- template: packages/db/src/executor.ts -->
```ts
import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { relations } from "./relations";

// What every query function takes first: the app's `db`, a transaction's `tx`, or the PGlite
// database in tests. All three extend PgAsyncDatabase, so one function serves all of them and
// composes inside `db.transaction(async (tx) => …)`.
export type Executor = PgAsyncDatabase<PgQueryResultHKT, typeof relations>;
```

## A query file and its test

<!-- template: packages/db/src/queries/users.ts -->
```ts
import { desc } from "drizzle-orm";
import type { Executor } from "../executor";
import { type User, users } from "../schema/users";
import type { NewUserInput } from "../validation/users";

// Query functions take the executor first so they work with `db`, inside a transaction (`tx`),
// and against PGlite in tests. No business rules here: what a query does, not who may run it.

export async function getUserById(db: Executor, id: string): Promise<User | undefined> {
  return db.query.users.findFirst({ where: { id } });
}

export type UserSummary = Pick<User, "id" | "name" | "email" | "role" | "createdAt">;

// A list always has a limit, and selects the columns it shows.
export async function listUsers(
  db: Executor,
  options: { limit?: number; offset?: number } = {},
): Promise<UserSummary[]> {
  const limit = Math.min(options.limit ?? 50, 100);
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(limit)
    .offset(options.offset ?? 0);
}

export type CreateUserResult = { ok: true; user: User } | { ok: false; error: "email-taken" };

// An expected failure (the email exists) is a result, not an exception.
export async function createUser(db: Executor, input: NewUserInput): Promise<CreateUserResult> {
  const [user] = await db
    .insert(users)
    .values(input)
    .onConflictDoNothing({ target: users.email })
    .returning();
  return user ? { ok: true, user } : { ok: false, error: "email-taken" };
}
```

<!-- template: packages/db/src/testing/pglite.ts -->
```ts
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
```

## Nested Biome config

<!-- template: packages/db/biome.json -->
```json
{
  "$schema": "https://biomejs.dev/schemas/2.5.15/schema.json",
  "extends": "//",
  "files": {
    "includes": ["**", "!!drizzle"]
  },
  "overrides": [
    {
      "includes": ["src/migrate.ts", "src/seed.ts"],
      "linter": { "rules": { "suspicious": { "noConsole": "off" } } }
    }
  ]
}
```
