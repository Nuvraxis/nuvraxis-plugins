import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { NewUserInput, UserLookupInput } from "./users";

describe("users validation", () => {
  it("UserLookupInput accepts a UUID and rejects anything else", () => {
    expect(
      v.safeParse(UserLookupInput, { id: "8f14e45f-ceea-467f-a0e6-1b2c3d4e5f60" }).success,
    ).toBe(true);
    expect(v.safeParse(UserLookupInput, { id: "42" }).success).toBe(false);
    expect(v.safeParse(UserLookupInput, {}).success).toBe(false);
  });

  it("NewUserInput trims and lowercases the email, and keeps only the form's fields", () => {
    const result = v.parse(NewUserInput, {
      email: "  Ada@Example.COM ",
      name: " Ada ",
      role: "admin",
    });
    expect(result).toEqual({ email: "ada@example.com", name: "Ada" });
  });
});
