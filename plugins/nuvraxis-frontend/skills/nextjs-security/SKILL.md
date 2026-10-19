---
name: nextjs-security
description: >-
  Security rules for Next.js 16 App Router apps — authentication and authorisation in every Server Action and route handler, session cookies, nonce-based Content Security Policy in proxy.ts (with nuvui's requirements), security headers, server-only and secret handling, CSRF/origin checks, open redirects, SSRF, rate limiting and dependency hygiene. Use when writing or reviewing "use server" files, route.ts handlers, proxy.ts, auth/session code, cookies, redirects, fetches to user-supplied URLs, next.config headers(), or when asked for a security review of a Next.js app.
when_to_use: >-
  "add login", "protect this page", "is this action safe", "add CSP", "security headers", "review for security", "store the token", "redirect back after login", "fetch this URL for the user".
---

# Next.js security

Use whenever code crosses a trust boundary in a Next.js app: a Server Action, a route handler, `proxy.ts`, a cookie, a redirect, an outbound fetch built from input. General app structure is in `nextjs-production`; container and Kubernetes hardening (non-root, read-only root filesystem, dropped capabilities) is in `docker-nextjs` and `helm-nextjs`, not repeated here.

## Rules

1. **Treat every Server Action as a public POST endpoint.**
   Anyone can call any exported action with any arguments, whatever page renders it and whether or not the button is visible. Hiding UI is not access control.
   Every action does, in this order: authenticate → validate input (valibot) → authorise against the specific resource → mutate → `updateTag`. See `nextjs-production` rule 6 for the code shape.

2. **Authorise in the data access layer, not in the page or in `proxy.ts`.**
   `proxy.ts` may redirect anonymous users to `/login` as a convenience (an optimistic cookie-presence check), but it runs only for matched paths and skips Server Action internals, so it is never the check. Put `requireSession()` and `assertCan(session, action, resource)` inside the `server-only` functions in `src/server/` that read and write data; pages and actions call those. Patterns: [references/auth-patterns.md](references/auth-patterns.md).
   ```ts
   // Wrong: authorisation lives in the page; the action is open
   export default async function Page() { if (!(await isAdmin())) redirect("/"); … }
   export async function deleteUser(id: string) { "use server"; await db.user.delete({ where: { id } }); }

   // Right: the data function enforces it, whoever calls it
   export async function deleteUser(id: UserId) {
     const session = await requireSession();
     assertCan(session, "user:delete", id);
     await db.user.delete({ where: { id } });
   }
   ```

3. **Sessions live in `httpOnly`, `secure`, `SameSite=Lax` cookies named with the `__Host-` prefix. Never in `localStorage`.**
   Why: anything readable by JavaScript is stolen by the first XSS; `__Host-` forbids `Domain` and requires `Path=/` and `Secure`, so a sibling subdomain can't overwrite it.
   ```ts
   (await cookies()).set("__Host-session", token, {
     httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 8,
   });
   ```
   Store an opaque session id (server-side lookup) or a signed, short-lived token. Rotate it on login and privilege change; delete it server-side on logout.

4. **Send a nonce-based CSP from `proxy.ts`. The template's file is the reference; keep nuvui's two allowances.**
   `script-src 'self' 'nonce-…' 'strict-dynamic'` with a fresh nonce per request; Next reads it from the request's CSP header and stamps its own scripts. nuvui needs `style-src-attr 'unsafe-inline'` (components set `style` attributes during SSR) and passes the nonce to `ScrollArea` (`<ScrollArea nonce={nonce}>`), its only `<style>` element. Never add `'unsafe-inline'` to `script-src` or `style-src`, and never `'unsafe-eval'` outside development.
   Nonces require per-request rendering, which is why the root layout has `export const instant = false` (see `nextjs-production` rule 15). The full policy, line by line: [references/csp.md](references/csp.md).

5. **Set the static security headers in `next.config.ts` `headers()` and turn off `x-powered-by`.**
   `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` denying what the app doesn't use, `Cross-Origin-Opener-Policy: same-origin`; `poweredByHeader: false`. Clickjacking is covered by the CSP's `frame-ancestors 'none'`. The template has them.

6. **Keep secrets on the server: `import "server-only"`, no `NEXT_PUBLIC_` secrets, no secrets in closures or props.**
   - Modules that read secrets or hold DB/SDK clients start with `import "server-only"`; a client import then fails the build.
   - `NEXT_PUBLIC_*` is inlined into the browser bundle. Never put a key there "temporarily".
   - Values a Server Action closes over are encrypted but still round-trip through the client. Read secrets inside the action, not in the component that defines it.
   - Return DTOs (only the fields the UI needs) from data functions, never whole ORM rows that may carry `passwordHash` or tokens.

7. **Don't enable `experimental.taint`.** It switches React to its experimental channel. The DTO rule above plus `server-only` gives the same protection on stable React. Revisit when taint is stable.

8. **Check `Origin` on cookie-authenticated route handlers that change state.**
   Server Actions already compare `Origin` with `Host` and reject mismatches; leave `experimental.serverActions.allowedOrigins` unset unless a known reverse proxy rewrites the host. Route handlers get no such check: for `POST`/`PUT`/`PATCH`/`DELETE` with cookie auth, reject requests whose `Origin` isn't the app's own (helper in `auth-patterns.md`). Never mutate on `GET`.

9. **Only redirect to relative paths you've validated.**
   `?next=` / `?returnTo=` values must start with a single `/` and not `//` or `/\`; otherwise fall back to `/`. Never `redirect(searchParams.next)` raw.
   ```ts
   export function safeRedirectPath(value: unknown): string {
     return typeof value === "string" && /^\/(?![/\\])/.test(value) ? value : "/";
   }
   ```

10. **Never fetch a URL the user controls without an allowlist.**
    A route handler or action that fetches `input.url` can be pointed at `http://169.254.169.254/` or in-cluster services (SSRF). Parse with `new URL()`, require `https:`, and match the hostname against an explicit allowlist. Keep `images.remotePatterns` to exact hostnames for the same reason: the image optimiser fetches on your server's behalf.

11. **Render untrusted HTML only after sanitising it on the server.** No `dangerouslySetInnerHTML` with user content unless it has gone through a sanitiser (e.g. `sanitize-html` with an explicit allowlist) on the server. Rich text from nuvui's editor is HTML: sanitise before storing or before rendering.

12. **Rate-limit at the ingress; add an app limiter only for auth endpoints.**
    In-memory limiters are per pod and reset on restart. Use ingress-nginx annotations (`nginx.ingress.kubernetes.io/limit-rps`, `limit-connections`) for broad protection; the chart has them as commented values. Login, signup, password reset and OTP verification additionally need a shared-store (Redis) limiter keyed by account and IP.

13. **Return generic errors to the client.** Actions return `{ ok: false, error: "…" }` with a message written for users; never `String(error)` or a stack. Unhandled errors already reach the client only as a `digest`; log the detail through `onRequestError`.

14. **Validate every input at the boundary: FormData, JSON bodies, `params`, `searchParams`, headers, cookies.** All are attacker-controlled strings. Parse with valibot before use; branded ids (`typescript-production`) keep an unparsed string from reaching a data function.

15. **Keep dependencies boring and pinned.**
    `pnpm install --frozen-lockfile` everywhere in CI; `pnpm audit --audit-level high` in `pr.yaml`; `minimumReleaseAge` and an explicit `allowBuilds` list in `pnpm-workspace.yaml` (see `pnpm-turborepo`) so a freshly published or install-script-running package can't land silently. New dependency → check its maintainers and install scripts before adding it.

## Verify

```sh
pnpm typecheck && pnpm lint && pnpm build
pnpm audit --audit-level high
pnpm --filter <app> start &
curl -s -D headers.txt -o page.html http://localhost:3000/
grep -iE "content-security-policy|strict-transport|x-content-type|referrer-policy" headers.txt
grep -o 'nonce="[^"]*"' page.html | sort -u   # one value, on every script
```

Then a manual pass: for each `"use server"` export and each `route.ts` method, confirm the four steps of rule 1 are present.

## Sources

- https://nextjs.org/docs/app/guides/data-security
- https://nextjs.org/docs/app/guides/authentication
- https://nextjs.org/docs/app/guides/content-security-policy
- https://nextjs.org/docs/app/api-reference/file-conventions/proxy
- https://nextjs.org/docs/app/api-reference/config/next-config-js/serverActions
- https://nextjs.org/docs/app/api-reference/config/next-config-js/headers
- https://nextjs.org/docs/app/api-reference/config/next-config-js/taint
- https://nuvui.nuvraxis.com/docs/content-security-policy (vendored: `nuvui/reference/content-security-policy.md`)
- https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies#cookie_prefixes
- https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html
- https://kubernetes.github.io/ingress-nginx/user-guide/nginx-configuration/annotations/#rate-limiting
- https://pnpm.io/supply-chain-security
