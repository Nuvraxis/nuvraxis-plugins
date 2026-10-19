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
