---
name: nextjs-production
description: >-
  Production rules for Next.js 16 App Router apps at Nuvraxis — Server/Client Component boundaries, Cache Components ("use cache", cacheLife, cacheTag, updateTag), Server Actions, route handlers, env handling, instrumentation, output standalone and the /api/health route. Use when the project has "next" in package.json, an app/ or src/app/ directory, next.config.ts, proxy.ts, instrumentation.ts, or files named page.tsx, layout.tsx, route.ts, loading.tsx, error.tsx.
when_to_use: >-
  "add a page", "fetch data", "cache this", "add a server action", "add an API route", "why is this env var undefined", "make it build for Docker", "add tracing", any edit inside apps/*/src/app/.
---

# Next.js in production

Use for any code in a Next.js 16 App Router app. Security-specific rules (auth in actions, CSP, headers, taint) are in `nextjs-security`; container rules in `docker-nextjs`. Claude Code's built-in `next-best-practices` skill covers general file conventions, metadata, image and font optimisation in depth; this skill only adds what's specific to how we build and ship.

Baseline: Next 16.4, React 19.3, Turbopack (default for `dev` and `build`), `cacheComponents: true` with `partialPrefetching: true`, `output: "standalone"`, `typedRoutes: true`. The template's `next.config.ts` is the source of truth.

## Before writing any UI: read nuvui first

Every page, component and stylesheet in these apps is built on nuvui. Never write nuvui code from memory: props, parts, blocks and tokens change between releases. Before the first line of UI, read the library through the nuvui MCP, in this order, passing the `@nuvui/react` version from the app's `package.json` as `version`:

1. **The app's `package.json`**: which `@nuvui/*` packages are installed, and at which versions.
2. **`get_rules`** without a topic, then with each topic the work touches (`forms`, `composition`, `styling`, `server-components`, `accessibility`, `text-and-direction`, `packages`).
3. **`get_changes`** with the installed `@nuvui/*` entries: what was added or changed since those versions.
4. **`list_components`** across every package, so you know what exists, add-on packages included, before writing anything of your own.
5. **`list_blocks`**, and **`list_charts`** for any chart. When one fits, **`get_block`** / **`get_chart`** and start from it.
6. **`list_guides`**, then **`get_page`** for each guide that applies (forms, theming, SCSS, CSP, translation, right to left, recipes).
7. **`get_page`** for every component you will use: the whole page (parts, props, examples, CSS variables, accessibility), not only Props. **`search_docs`** for anything you can't place.
8. **`get_tokens`** before writing any CSS value.

Only then write code. If the MCP isn't connected, read the same things from the vendored `nuvui` skill ([SKILL.md](../nuvui/SKILL.md), [reference.md](../nuvui/reference.md), [blocks.md](../nuvui/blocks.md), [recipes.md](../nuvui/recipes.md), [tokens.md](../nuvui/tokens.md), `rules/`), and say that you did, because it can be behind the latest release.

## Rules

1. **Server Components by default; `"use client"` only for state, effects, browser APIs or event handlers.**
   Put the directive on the smallest leaf that needs it. Don't add it because a file imports nuvui: nuvui's stateful parts carry their own directive (see the `nuvui` skill, `rules/server-components.md`).
   ```tsx
   // Wrong: whole page is client because of one handler
   "use client";
   export default function Page() { … <Select onValueChange={…} /> … }

   // Right: the page stays on the server, the handler lives in a leaf
   export default async function Page() {
     const people = await getPeople();
     return <PeopleFilter people={people} />; // people-filter.tsx has "use client"
   }
   ```
   Props crossing into a client component must be serialisable: no functions (except Server Actions), no class instances.

2. **Fetch on the server, in the component that needs the data.** No `useEffect` fetching, no route handler just to feed your own page. Deduplicate per request with React `cache()`; cache across requests with rule 3.

3. **Cache with `"use cache"` + `cacheLife` + `cacheTag`; everything else is dynamic.**
   With Cache Components, nothing is cached unless you say so, and `fetch` has no implicit cache.
   ```ts
   import { cacheLife, cacheTag } from "next/cache";

   export async function getInvoice(id: InvoiceId) {
     "use cache";
     cacheLife("minutes");
     cacheTag(`invoice:${id}`);
     return db.invoice.findUnique({ where: { id } });
   }
   ```
   Don't use the old segment config (`export const dynamic`, `revalidate`, `fetchCache`): it errors under Cache Components. Arguments and closed-over values become part of the cache key, so pass ids, not whole request objects. Details, the profiles and `"use cache: private"`: [references/caching.md](references/caching.md).

4. **Invalidate with `updateTag` in Server Actions, `revalidateTag(tag, "max")` elsewhere.**
   `updateTag(tag)` gives read-your-own-writes and only works inside a Server Action. From a webhook or route handler use `revalidateTag(tag, "max")` (stale-while-revalidate) or `revalidateTag(tag, { expire: 0 })`. The one-argument `revalidateTag(tag)` is deprecated.

5. **Wrap request-time data in `<Suspense>`, or the build fails.**
   `cookies()`, `headers()`, `searchParams`, `connection()` and uncached I/O outside a Suspense boundary stop prerendering with "uncached or runtime data during prerendering". Give it a boundary with a skeleton fallback, cache it, or (root layout only, see rule 14) mark the route blocking with `export const instant = false`. All of `params`, `searchParams`, `cookies()`, `headers()` are async: `await` them.

6. **Every Server Action validates its input and checks authorisation itself.**
   A Server Action is a public POST endpoint whatever page it's written on. Parse `FormData` with the schema from `typescript-production` (valibot), then authorise, then mutate, then `updateTag`. Return a typed result for expected failures; throw only for bugs. The full rule set is in `nextjs-security`.
   ```ts
   "use server";
   export async function renameProject(_: State, form: FormData): Promise<State> {
     const session = await requireSession();                  // 401 if absent
     const input = v.safeParse(RenameProject, Object.fromEntries(form));
     if (!input.success) return { ok: false, errors: flatten(input.issues) };
     await assertCanEdit(session, input.output.projectId);    // 403 if not allowed
     await db.project.update(…);
     updateTag(`project:${input.output.projectId}`);
     return { ok: true };
   }
   ```

7. **Route handlers are for other clients (webhooks, mobile, health), not for your own pages.** Put them under `app/api/`. Validate the body like an action, return `Response.json(...)`, and set status codes on purpose.

8. **Every app has `GET /api/health`, dynamic and dependency-free.**
   Docker `HEALTHCHECK` and the Kubernetes probes hit it. It must answer without touching the database, so a slow dependency doesn't restart every pod. `await connection()` keeps it from being prerendered into a static file. It's in the template at `src/app/api/health/route.ts`; `proxy.ts` excludes `/api/health` from its matcher.

9. **`error.tsx`, `loading.tsx` and `not-found.tsx` at the root, and per segment where the UX differs.** `error.tsx` is a client component; log through `instrumentation.ts`'s `onRequestError`, show a retry with `reset`, never the error message. Call `notFound()` for missing records instead of rendering an empty state.

10. **`NEXT_PUBLIC_*` is baked in at build; everything else is read at runtime on the server.**
    One image is promoted from main to production unchanged, so a `NEXT_PUBLIC_` value is the same in every environment. Only put build-time constants there (app name, a public Sentry DSN that is the same everywhere). Per-environment config (API URLs, feature flags, secrets) is a server-side `process.env.X`, read in a Server Component or action, and passed to the client as props if needed. Validate env once in `src/env.ts` (valibot) and import from there. Never use the `env` key in `next.config.ts`: it's inlined into client bundles.

11. **Mark server-only modules with `import "server-only"`.** Anything that reads secrets, talks to the DB or imports an SDK with credentials. A client import of it then fails the build instead of leaking.

12. **`after()` for work that shouldn't delay the response** (audit logs, analytics, cache warm-up). Read `cookies()`/`headers()` before calling `after`, not inside it. It runs in the same process, so the pod needs its SIGTERM grace period (the chart sets `terminationGracePeriodSeconds`).

13. **Instrument with `src/instrumentation.ts`: `registerOTel` + `onRequestError`.** OpenTelemetry via `@vercel/otel`, exporter configured by the standard `OTEL_EXPORTER_OTLP_*` env vars at runtime. See [references/observability.md](references/observability.md).

14. **Keep `output: "standalone"` and never import from outside the workspace.**
    The Docker runner copies only `.next/standalone`, `.next/static` and `public`. In the monorepo, `server.js` lands at `.next/standalone/apps/<app>/server.js`; the workspace root is found from `pnpm-lock.yaml`, so don't set `outputFileTracingRoot` or `turbopack.root` unless the build warns. Self-hosting details (multi-replica, Server Action keys, `deploymentId`): [references/self-hosting.md](references/self-hosting.md).

15. **The root layout reads the CSP nonce, so the app renders per request.**
    The template's `proxy.ts` sets a nonce-based CSP and `src/app/layout.tsx` has `export const instant = false`. That's a deliberate trade: nonces and prerendered static shells can't coexist, and for logged-in business apps a strict CSP wins. Data caching with `"use cache"` still works. Don't remove either half without reading `nextjs-security` rule 4.

16. **Styles: global BEM SCSS, imported by the component.** Turbopack compiles Sass with the `sass` package; `sassOptions.loadPaths: ["src/styles"]` makes `@use "abstracts"` work from any depth. No `~` imports, no `sassOptions.functions`. Rules in `scss-bem`.

17. **Images through `next/image`, fonts through `next/font`.** `sharp` comes with Next for the optimiser; the runner image needs no extra package. Remote images need `images.remotePatterns` with an exact hostname.

18. **Check bundle size with `pnpm next analyze`** (Turbopack's analyzer; `@next/bundle-analyzer` is webpack-only). Lazy-load heavy client widgets (nuvui editor, maps, charts below the fold) with `next/dynamic`. `@nuvui/media` already loads hls.js or dashjs only when a stream plays, through the `hls={() => import("hls.js")}` prop: don't import them at the top of a file.

19. **Use typed routes and generated types.** `typedRoutes: true` checks `<Link href>`; `PageProps<"/invoices/[id]">` and `LayoutProps` are global after `next typegen` (run automatically by `next dev`/`next build`). Don't hand-write `params` types.

20. **No `next lint`.** It was removed in 16. Biome lints (see `biome`); TypeScript checks with `tsc --noEmit` per package.

## Verify

```sh
pnpm typecheck
pnpm lint
pnpm build                      # turbo run build: fails on prerender errors, type errors, Sass errors
pnpm --filter <app> start &     # then:
curl -fsS localhost:3000/api/health
```

## Sources

- https://nextjs.org/docs/app/guides/upgrading/version-16
- https://nextjs.org/docs/app/api-reference/config/next-config-js/cacheComponents
- https://nextjs.org/docs/app/guides/migrating-to-cache-components
- https://nextjs.org/docs/app/api-reference/directives/use-cache
- https://nextjs.org/docs/app/api-reference/functions/revalidateTag
- https://nextjs.org/docs/app/api-reference/functions/updateTag
- https://nextjs.org/docs/messages/blocking-prerender-dynamic
- https://nextjs.org/docs/app/api-reference/functions/after
- https://nextjs.org/docs/app/guides/open-telemetry
- https://nextjs.org/docs/app/api-reference/config/next-config-js/output
- https://nextjs.org/docs/app/guides/self-hosting
- https://nextjs.org/docs/app/guides/environment-variables
- https://nextjs.org/docs/app/guides/sass
- https://nextjs.org/docs/app/guides/package-bundling
- https://nextjs.org/docs/app/api-reference/file-conventions/proxy
