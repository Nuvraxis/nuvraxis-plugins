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
