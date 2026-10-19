import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type { relations } from "./relations";

// What every query function takes first: the app's `db`, a transaction's `tx`, or the PGlite
// database in tests. All three extend PgAsyncDatabase, so one function serves all of them and
// composes inside `db.transaction(async (tx) => …)`.
export type Executor = PgAsyncDatabase<PgQueryResultHKT, typeof relations>;
