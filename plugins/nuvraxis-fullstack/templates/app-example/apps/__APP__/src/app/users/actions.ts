"use server";

import { db, getUserById, UserLookupInput } from "@__SCOPE__/db";
import * as v from "valibot";

export type LookupState =
  | { status: "idle" }
  | { status: "invalid"; message: string }
  | { status: "not-found" }
  | { status: "found"; user: { id: string; name: string } };

// Example wiring: FormData → the valibot schema derived from the users table → a query function
// from @__SCOPE__/db. A Server Action is a public endpoint: before real use, authenticate and
// authorise here (nextjs-security skill), or delete this example.
export async function lookupUser(_previous: LookupState, form: FormData): Promise<LookupState> {
  const input = v.safeParse(UserLookupInput, { id: form.get("id") });
  if (!input.success) return { status: "invalid", message: "Enter a user id (a UUID)." };

  const user = await getUserById(db, input.output.id);
  if (!user) return { status: "not-found" };

  // Return only what the screen shows, never the whole row.
  return { status: "found", user: { id: user.id, name: user.name } };
}
