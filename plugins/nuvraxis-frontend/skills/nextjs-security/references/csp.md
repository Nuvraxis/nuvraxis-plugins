# Content Security Policy

The template's `apps/<app>/src/proxy.ts` is the source of truth. This page explains it line by line.

## The policy (production)

```
default-src 'self';
script-src 'self' 'nonce-{nonce}' 'strict-dynamic';
style-src 'self' 'nonce-{nonce}';
style-src-attr 'unsafe-inline';
img-src 'self' blob: data:;
font-src 'self';
connect-src 'self';
worker-src 'self' blob:;
object-src 'none';
base-uri 'self';
form-action 'self';
frame-ancestors 'none'
```

| Directive | Why |
|---|---|
| `script-src 'nonce-…' 'strict-dynamic'` | Next stamps the nonce on its scripts; `strict-dynamic` lets those load their chunks. No host allowlists to maintain. |
| `style-src 'self' 'nonce-…'` | The app's and nuvui's stylesheets, plus nuvui `ScrollArea`'s one `<style>` element, which takes the nonce. |
| `style-src-attr 'unsafe-inline'` | nuvui (and Radix, Recharts) set `style` attributes during server rendering: progress width, slider position, chart colors. Without it they're dropped. A `style` attribute can't select other elements, so it can't exfiltrate page content. |
| `img-src blob: data:` | `blob:` for nuvui previews and QR/barcode PNG export; `data:` for small inline images and `next/image` blur placeholders. |
| `worker-src blob:` | `@nuvui/map` starts MapLibre's worker from a blob. Drop it if the app has no map. |
| `object-src 'none'`, `base-uri 'self'` | Close two classic injection paths. |
| `form-action 'self'` | Forms (and Server Actions) post only to this origin. |
| `frame-ancestors 'none'` | No one can frame the app (clickjacking). Replaces `X-Frame-Options`. |

In development the proxy adds `'unsafe-eval'` to `script-src` (React's dev tooling needs it) and uses `'unsafe-inline'` for `style-src` (dev CSS injection). Never in production.

## Adding a third party

| Need | Change |
|---|---|
| API calls from the browser to `api.example.com` | `connect-src 'self' https://api.example.com` |
| Map tiles from a provider | its host in `connect-src` and `img-src` |
| Images from a CDN | its host in `img-src` (and `images.remotePatterns`) |
| A third-party script | load it with `next/script` and `nonce={nonce}`; `strict-dynamic` covers what it loads |
| Embedding in your own other app | `frame-ancestors https://admin.example.com` |

Add exact hosts. Never `https:` or `*`.

## The nonce in components

- Server Components: `(await headers()).get("x-nonce")`.
- Client Components: the template's `NonceProvider` in the root layout puts it in context; `useNonce()` reads it.

```tsx
"use client";
import { ScrollArea } from "@nuvui/react";
import { useNonce } from "@/components/nonce-provider/nonce-provider";

export function LogPanel({ lines }: { lines: string[] }) {
  return <ScrollArea nonce={useNonce()} className="log-panel">{/* … */}</ScrollArea>;
}
```

## Why the app renders per request

A nonce is a fresh value per response. A page prerendered at build time (a Cache Components static shell, or a fully static page) was rendered before any request existed, so its scripts carry no nonce and the browser blocks them. Next's docs say it directly: nonce-based CSP and static shells don't mix.

The template resolves it by reading the nonce in the root layout and setting `export const instant = false` there, which tells Cache Components that blocking on request data is intended. Every page then renders per request; `"use cache"` still caches the data and component output underneath.

If a public, mostly static site is ever more important than a strict CSP, the alternatives are:

- `experimental.sri` (build-time hashes for Next's scripts, keeps static pages; experimental, and Turbopack support is unconfirmed), or
- a CSP without nonces (`script-src 'self'` plus hashes), which Next's inline bootstrap scripts don't satisfy.

Neither is the default. Decide per app and write the reason in the app's `CLAUDE.md`.

## Checking it

```sh
curl -sI http://localhost:3000/ | grep -i content-security-policy
curl -s  http://localhost:3000/ | grep -o 'nonce="[^"]*"' | sort -u   # one value, on every script
```

In the browser, the console reports every blocked resource as a CSP violation. Load each main screen once with DevTools open after changing the policy.

## The file

<!-- template: apps/__APP__/src/proxy.ts -->
```ts
import { type NextRequest, NextResponse } from "next/server";

// A fresh nonce per request, sent as the Content-Security-Policy. Next reads the nonce from
// the request's CSP header and puts it on its own scripts; the root layout reads x-nonce for
// anything else that needs it (nuvui's ScrollArea, next/script).
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // nuvui: ScrollArea's one <style> element takes the nonce; components set style attributes.
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Documents only: not route handlers (/api/health included), static files, image
      // optimisation, or prefetches.
      source: "/((?!api/|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
```
