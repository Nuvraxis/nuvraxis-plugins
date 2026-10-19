# Validation at the edges: drizzle-orm/valibot

v1 ships the validator integrations inside drizzle-orm. The frontend plugin standardised on **valibot** (it tree-shakes for client-side forms), so the database layer uses `drizzle-orm/valibot`, not zod. One validation library per repo.

## The template's schemas

<!-- template: packages/db/src/validation/users.ts -->
```ts
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
```

- `createSelectSchema(table)`: a row as read. Useful for ids (`v.pick(userSelectSchema, ["id"])` validates a uuid column as a UUID, so a malformed id never reaches Postgres as a query error).
- `createInsertSchema(table, refinements)`: what insert accepts, with required/optional derived from `notNull`/defaults. Refinements receive the column's base schema; pipe more checks or transforms onto it.
- `createUpdateSchema(table)`: every column optional, for patches.
- `v.pick` / `v.omit` per use case: a sign-up form picks `email` and `name`; `role`, `id` and timestamps are never accepted from a client.

## In a Server Action

```ts
"use server";
import { createUser, db, NewUserInput } from "@repo/db";
import * as v from "valibot";

export async function signUp(_: State, form: FormData): Promise<State> {
  const session = await requireSession();               // nextjs-security: authn + authz first
  const input = v.safeParse(NewUserInput, Object.fromEntries(form));
  if (!input.success) return { ok: false, errors: v.flatten(input.issues).nested };
  const result = await createUser(db, input.output);
  return result.ok ? { ok: true } : { ok: false, error: "That email is already registered." };
}
```

## Rules

- Never `db.insert(users).values(Object.fromEntries(form))`: FormData values are strings or files, unvalidated, and may include fields the form didn't show.
- The schema derives from the table, so a new `notNull` column without a default makes the insert schema reject old forms at once, before the database does.
- Transform at the edge (`v.trim()`, `v.toLowerCase()`), so stored values are normalised and unique indexes behave.
- Database constraints still exist: validation gives users good errors; constraints keep the data right when validation is bypassed.
