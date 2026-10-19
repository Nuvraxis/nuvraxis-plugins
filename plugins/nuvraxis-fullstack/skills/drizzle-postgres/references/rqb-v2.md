# Relational queries (RQB v2) and the select builder

`db.query.<table>` exists for every table passed to `defineRelations(schema, …)`.

## Which API

| Query | Use |
|---|---|
| One record, maybe with children | `db.query.users.findFirst({ where, with })` |
| A list with nested children | `db.query.posts.findMany({ where, with, orderBy, limit })` |
| Joins across unrelated tables, aggregates, `groupBy`, window functions | `db.select({...}).from(...).innerJoin(...)` |
| Writes | `db.insert/update/delete(...).returning()` |

## RQB v2 shapes

```ts
await db.query.posts.findMany({
  columns: { id: true, title: true, createdAt: true }, // partial select; omit to get all
  where: {
    published: true,
    createdAt: { gte: since },
    OR: [{ title: { ilike: "%drizzle%" } }, { authorId: { in: authorIds } }],
    author: { role: "admin" },                           // filter through a relation
  },
  with: {
    author: { columns: { id: true, name: true } },
    comments: { limit: 3, orderBy: { createdAt: "desc" } },
  },
  orderBy: { createdAt: "desc" },
  limit: 20,
  offset: 0,
});
```

Per-column operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `notIn`, `like`, `ilike`, `notLike`, `notIlike`, `isNull`, `isNotNull`, `arrayContains`, `arrayContained`, `arrayOverlaps`. A bare value means `eq`. Combinators: `AND: [...]`, `OR: [...]`, `NOT: {...}`, `RAW: (t) => sql`…``.

### The callback rule

Inside RQB, columns are aliased. Raw SQL and computed ordering must reference the table through the callback argument:

```ts
// Wrong: the imported table, wrong alias in the generated SQL
where: { RAW: sql`lower(${users.email}) = ${email}` }

// Right
where: { RAW: (t) => sql`lower(${t.email}) = ${email}` }
orderBy: (t, { desc }) => desc(t.createdAt)
```

## Select builder

```ts
import { and, count, desc, eq, gte } from "drizzle-orm";

await db
  .select({ authorId: posts.authorId, posts: count() })
  .from(posts)
  .where(and(eq(posts.published, true), gte(posts.createdAt, since)))
  .groupBy(posts.authorId)
  .orderBy(desc(count()))
  .limit(10);
```

Always name the columns. `select()` with nothing selects every column of every joined table.

## Dynamic queries

```ts
let query = db.select({ id: users.id, name: users.name }).from(users).$dynamic();
if (role) query = query.where(eq(users.role, role));
const rows = await query.orderBy(desc(users.createdAt)).limit(limit);
```

## Prepared statements

```ts
const byEmail = db.query.users.findFirst({ where: { email: sql.placeholder("email") } }).prepare();
await byEmail.execute({ email });
```

Unnamed `.prepare()` is safe behind PgBouncer in transaction mode. A named one (`.prepare("by_email")`) creates a server-side statement on one connection; avoid it behind transaction pooling unless PgBouncer's `max_prepared_statements` is set.
