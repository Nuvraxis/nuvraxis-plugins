# Schema cheatsheet (Drizzle v1, PostgreSQL)

All imports from `drizzle-orm/pg-core`. Tables are declared with `snakeCase.table` (camelCase keys, snake_case columns).

## The reference table (template)

<!-- template: packages/db/src/schema/users.ts -->
```ts
import { index, pgEnum, snakeCase, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

// A closed set the database enforces. A set that will keep growing (plans, feature flags)
// is better as text plus a union type in the app: changing a pgEnum needs a migration.
export const userRole = pgEnum("user_role", ["admin", "member", "viewer"]);

// snakeCase.table: camelCase keys in TypeScript, snake_case columns in SQL. Names are
// written once.
export const users = snakeCase.table(
  "users",
  {
    // uuid, not a bigint identity: ids appear in URLs and in other services, where a random
    // id is neither guessable nor a count of rows, and can be created without a round trip.
    id: uuid().primaryKey().defaultRandom(),
    // Stored lowercased (see validation/users.ts) so the unique index is case-insensitive in
    // practice.
    email: text().notNull(),
    name: text().notNull(),
    role: userRole().notNull().default("member"),
    createdAt: timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("users_email_key").on(t.email),
    index("users_created_at_idx").on(t.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserRole = (typeof userRole.enumValues)[number];
```

Generated SQL for it (`drizzle/<timestamp>_init/migration.sql`):

<!-- template: packages/db/drizzle/20261019110459_init/migration.sql -->
```sql
CREATE TYPE "user_role" AS ENUM('admin', 'member', 'viewer');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'member'::"user_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" ("email");--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" ("created_at");
```

## Columns

| Need | Column | Notes |
|---|---|---|
| Public id | `uuid().primaryKey().defaultRandom()` | `gen_random_uuid()` (v4) |
| Internal id | `integer().primaryKey().generatedAlwaysAsIdentity()` | or `bigint({ mode: "number" })` for large tables |
| Text | `text().notNull()` | limits in validation |
| Money | `numeric({ precision: 12, scale: 2, mode: "string" })` or integer cents | never `real`/`doublePrecision` |
| Flag | `boolean().notNull().default(false)` | |
| Point in time | `timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow()` | |
| Calendar date | `date({ mode: "string" })` | `"2026-10-19"`, no time zone games |
| Closed set | `pgEnum("name", ["a", "b"])`, used as `name()` | changing it is a migration |
| Growing set | `text().$type<"a" \| "b" \| "c">()` | validated in the app |
| JSON | `jsonb().$type<T>().notNull().default({})` | validate on write |
| Array | `text().array()`; multi-dimensional `.array("[][]")` | v1 replaced chained `.array().array()` |
| Generated | ``.generatedAlwaysAs(sql`…`)`` | v1 accepts only `sql` |

## Constraints and indexes (table callback, returns an array)

```ts
(t) => [
  uniqueIndex("users_email_key").on(t.email),
  index("posts_author_id_idx").on(t.authorId),
  index("posts_published_idx").on(t.publishedAt).where(sql`${t.publishedAt} is not null`),
  primaryKey({ columns: [t.userId, t.groupId] }),
  check("posts_title_not_empty", sql`length(${t.title}) > 0`),
]
```

## Foreign keys

```ts
authorId: uuid().notNull().references(() => users.id, { onDelete: "cascade" }),
// onDelete: "cascade" | "restrict" | "set null" | "set default" | "no action": always say which.
```

`cascade` when the child can't exist without the parent (a user's sessions); `restrict` when deleting the parent should be refused while children exist (an invoice's customer); `set null` only for optional references.

## Inferred types

```ts
export type User = typeof users.$inferSelect;   // a row as read
export type NewUser = typeof users.$inferInsert; // what insert accepts
```

## v0 → v1 renames worth knowing

| v0 | v1 |
|---|---|
| `drizzle({ casing: "snake_case" })` | `snakeCase.table(...)` |
| `relations()` | `defineRelations()` (see SKILL.md rule 9) |
| `getTableColumns()` | `getColumns()` |
| `pgTable.enableRLS()` | `pgTable.withRLS()` |
| `meta/_journal.json` migrations | per-migration folders; `drizzle-kit up` converts |
| `drizzle-zod` / `drizzle-valibot` packages | `drizzle-orm/zod`, `drizzle-orm/valibot` |
