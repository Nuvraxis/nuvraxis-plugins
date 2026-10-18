# Auth patterns

These are shapes, not a library choice. Whether sessions come from your own table, an OIDC provider or an auth library, the boundaries stay the same.

## Layout

```
src/server/
├─ session.ts        # getSession(), requireSession(): reads the cookie, looks the session up
├─ authz.ts          # assertCan(session, action, resource)
├─ errors.ts         # Unauthenticated, Forbidden
└─ invoices.ts       # data functions: every one starts with requireSession() + assertCan()
```

Every file in `src/server/` begins with `import "server-only"`.

## Session

```ts
// src/server/session.ts
import "server-only";
import { cookies } from "next/headers";
import { cache } from "react";
import { Unauthenticated } from "./errors";

export type Session = { userId: UserId; orgId: OrgId; role: "admin" | "member" | "viewer" };

const COOKIE = "__Host-session";

// Deduplicated per request: layout, page and actions share one lookup.
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  return lookupSession(token); // your store: DB row, Redis, or verify a signed token
});

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new Unauthenticated();
  return session;
}
```

Login sets the cookie as in SKILL.md rule 3, after rotating the session id. Logout deletes the server-side session first, then the cookie.

## Authorisation

```ts
// src/server/authz.ts
import "server-only";
import { Forbidden } from "./errors";

type Action = "invoice:read" | "invoice:update" | "user:delete";

export function assertCan(session: Session, action: Action, resource: { orgId: OrgId }) {
  if (resource.orgId !== session.orgId) throw new Forbidden();
  if (action === "user:delete" && session.role !== "admin") throw new Forbidden();
}
```

Check against the loaded resource (`resource.orgId`), not against an id the client sent. Load, then check, then act.

## A data function

```ts
// src/server/invoices.ts
import "server-only";

export async function markInvoicePaid(id: InvoiceId) {
  const session = await requireSession();
  const invoice = await db.invoice.findUnique({ where: { id } });
  if (!invoice) return { ok: false as const, error: "not-found" as const };
  assertCan(session, "invoice:update", invoice);
  await db.invoice.update({ where: { id }, data: { paidAt: new Date() } });
  return { ok: true as const };
}
```

The Server Action is then thin: parse `FormData`, call the data function, `updateTag`, return.

## Mapping errors

- In a page: catch `Unauthenticated` → `redirect("/login?next=…")` with `safeRedirectPath`; `Forbidden` → `forbidden()` or `notFound()` (don't reveal that the record exists).
- In a Server Action: return `{ ok: false, error: "forbidden" }`; the client shows a message.
- In a route handler: `401` / `403` with a JSON body, no details.

## Origin check for route handlers

```ts
// src/server/origin.ts
import "server-only";

// For cookie-authenticated, state-changing route handlers. Server Actions already do this.
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  return new URL(origin).host === new URL(request.url).host;
}
```

Behind the ingress, `request.url` carries the public host as long as the ingress forwards `Host` (ingress-nginx does). If it doesn't, compare against a configured `APP_ORIGIN` env var instead.

## Webhooks

Webhooks aren't cookie-authenticated. Verify the provider's signature over the raw body (`await request.text()` before parsing), with a constant-time comparison, and reject stale timestamps. Then parse with valibot.

## Proxy redirect (optional, UX only)

```ts
// in proxy.ts, before building the CSP response
if (request.nextUrl.pathname.startsWith("/app") && !request.cookies.has("__Host-session")) {
  const login = new URL("/login", request.url);
  login.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(login);
}
```

This only saves a round trip for logged-out users. It proves nothing about the cookie's validity and is not a security check.
