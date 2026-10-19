import { createInsertSchema, createSelectSchema } from "drizzle-orm/valibot";
import * as v from "valibot";
import { users } from "../schema/users";

// Derived from the table, so a column change reaches validation without being written twice.
// Refine per use case at the edge; never pass FormData or a request body straight to insert.
export const userSelectSchema = createSelectSchema(users);

export const userInsertSchema = createInsertSchema(users, {
  email: (schema) => v.pipe(schema, v.trim(), v.toLowerCase(), v.email(), v.maxLength(254)),
  name: (schema) => v.pipe(schema, v.trim(), v.minLength(1), v.maxLength(200)),
});

// What a sign-up form may set. id, role and timestamps are the server's to decide.
export const NewUserInput = v.pick(userInsertSchema, ["email", "name"]);
export type NewUserInput = v.InferOutput<typeof NewUserInput>;

// Looking a user up by id: the id column's own schema, required.
export const UserLookupInput = v.pick(userSelectSchema, ["id"]);
export type UserLookupInput = v.InferOutput<typeof UserLookupInput>;
