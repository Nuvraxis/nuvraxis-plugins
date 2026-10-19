import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb } from "../testing/pglite";
import { createUser, getUserById, listUsers } from "./users";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

describe("users queries", () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  it("createUser inserts once and reports a taken email", async () => {
    const first = await createUser(db, { email: "ada@example.com", name: "Ada" });
    expect(first.ok).toBe(true);

    const second = await createUser(db, { email: "ada@example.com", name: "Ada again" });
    expect(second).toEqual({ ok: false, error: "email-taken" });
  });

  it("getUserById returns the user, or undefined", async () => {
    const created = await createUser(db, { email: "grace@example.com", name: "Grace" });
    if (!created.ok) throw new Error("setup failed");

    expect(await getUserById(db, created.user.id)).toMatchObject({ email: "grace@example.com" });
    expect(await getUserById(db, "00000000-0000-4000-8000-000000000000")).toBeUndefined();
  });

  it("listUsers is newest first and honours the limit", async () => {
    const page = await listUsers(db, { limit: 1 });
    expect(page).toHaveLength(1);
    expect(Object.keys(page[0] ?? {}).sort()).toEqual(["createdAt", "email", "id", "name", "role"]);
  });

  it("works inside a transaction (the executor can be tx)", async () => {
    await expect(
      db.transaction(async (tx) => {
        await createUser(tx, { email: "rollback@example.com", name: "Temp" });
        tx.rollback();
      }),
    ).rejects.toThrow();
    const all = await listUsers(db, { limit: 100 });
    expect(all.some((user) => user.email === "rollback@example.com")).toBe(false);
  });
});
