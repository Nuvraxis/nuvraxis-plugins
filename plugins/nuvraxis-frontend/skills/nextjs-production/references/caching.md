# Caching with Cache Components (Next 16)

`next.config.ts` has `cacheComponents: true` and `partialPrefetching: true`. Under it:

- Nothing is cached unless it's inside a `"use cache"` scope. `fetch` included.
- `export const dynamic`, `revalidate` and `fetchCache` error. `dynamicParams` fails the build.
- Request-time data outside `<Suspense>` fails the build (see SKILL.md rule 5).

## The three directives

| Directive | Stored where | Can read cookies/headers | Use for |
|---|---|---|---|
| `"use cache"` | In-memory LRU per server process (or `cacheHandlers.default`) | No (pass values in as arguments) | Shared data: catalog, settings, a record by id |
| `"use cache: private"` | Browser memory only, never a server cache in production | Yes | Per-user data you want reused on client navigation |
| `"use cache: remote"` | `cacheHandlers.remote` (Redis etc.) | No | Shared data that must be shared across replicas |

None of them survive a deploy: the key includes the build id.

## Where to put the directive

- **On a data function** (most common): the cache key is the function plus its serialised arguments.
- **On a component**: caches the rendered output; props are the key.
- **At the top of a file**: every export is cached. Avoid; it hides what's cached.

```ts
import "server-only";
import { cacheLife, cacheTag } from "next/cache";

export async function listInvoices(orgId: OrgId, status: InvoiceStatus) {
  "use cache";
  cacheLife("minutes");
  cacheTag(`org:${orgId}:invoices`);
  return db.invoice.findMany({ where: { orgId, status } });
}
```

Never cache something that depends on who is asking unless the identity is part of the arguments (and then prefer `"use cache: private"`). A cached function can't call `cookies()`, `headers()` or `connection()`.

## `cacheLife` profiles

Built-in: `"seconds"`, `"minutes"`, `"hours"`, `"days"`, `"weeks"`, `"max"`, plus the default when none is given. Each has `stale` (client may reuse without asking), `revalidate` (server refreshes in the background after) and `expire` (hard limit). Define your own in `next.config.ts` only when a built-in doesn't fit:

```ts
cacheLife: {
  pricing: { stale: 60, revalidate: 300, expire: 3600 },
},
```

## Invalidation

| Where | Call | Effect |
|---|---|---|
| Server Action, after a write | `updateTag("org:42:invoices")` | Expires now; the action's own response sees fresh data |
| Server Action, refresh the current page's uncached parts | `refresh()` from `next/cache` | Re-renders dynamic parts, cache untouched |
| Webhook / route handler | `revalidateTag("org:42:invoices", "max")` | Stale-while-revalidate |
| Webhook that must be instant | `revalidateTag(tag, { expire: 0 })` | Hard expire |
| Anywhere, path-based | `revalidatePath("/invoices")` | Coarse; prefer tags |

Tag naming: `<entity>:<id>` for one record, `<scope>:<id>:<collection>` for lists. Tag both when a write changes a record that appears in a list.

## Multiple replicas

The default `"use cache"` store is per process. With 3 pods, each warms its own cache, and `updateTag` in one pod doesn't expire the others' entries. That's acceptable for short `cacheLife` values. When it isn't:

- move the hot paths to `"use cache: remote"` and configure `cacheHandlers.remote` (implements `get`, `set`, `refreshTags`, `getExpiration`, `updateTags`; `refreshTags` is what keeps tags in sync across pods), or
- keep `cacheLife` short enough that a stale pod is harmless.

Don't add a shared cache handler until you've measured the need.

## Request deduplication (not caching)

React's `cache()` deduplicates within one render, for example `getSession()` called from the layout and the page. It is not a cross-request cache and needs no invalidation.

```ts
import { cache } from "react";
export const getSession = cache(async () => { … });
```
