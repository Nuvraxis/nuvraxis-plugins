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
