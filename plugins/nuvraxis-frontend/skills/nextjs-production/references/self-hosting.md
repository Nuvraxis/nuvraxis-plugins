# Self-hosting on Kubernetes

The app runs as `node apps/<app>/server.js` from the standalone output, in the image built by `docker-nextjs`, deployed by `helm-nextjs`. These are the Next-side facts those skills rely on.

## Standalone output

- `output: "standalone"` traces the files the server needs into `.next/standalone/`. In the monorepo it mirrors the workspace: `.next/standalone/apps/<app>/server.js`, with `node_modules` beside it.
- It does **not** include `public/` or `.next/static/`. The Dockerfile copies them to `apps/<app>/public` and `apps/<app>/.next/static` inside the standalone tree.
- The workspace root is detected from `pnpm-lock.yaml`. Set `outputFileTracingRoot` only if the build warns about the root; if you set it, `turbopack.root` must match (setting one sets both).
- `server.js` reads `PORT` (default 3000) and `HOSTNAME`. In a container `HOSTNAME=0.0.0.0` is required, or it listens on the container's hostname only and probes fail.
- Don't build the standalone output on Windows and copy it: it can contain junctions with absolute targets. Build in the container.

## Writable paths

`.next/cache` holds the image optimiser's output and the default ISR/fetch cache. With `readOnlyRootFilesystem: true` it must be a mounted `emptyDir`. The chart mounts one at `/app/apps/<app>/.next/cache`. Nothing else is written at runtime.

## Multiple replicas and rolling updates

- **Server Action encryption key.** Each `next build` generates a key that encrypts closed-over values in Server Actions. One image means one key, so all replicas of the same image agree, and our pipeline builds each commit once. Set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (base64, 32 bytes, `openssl rand -base64 32`) as a BuildKit secret at build time only if the same commit is built more than once and served together, for example per-architecture builds served from a cluster that mixes amd64 and arm64 nodes. It's baked into the build output, not read at runtime.
- **Version skew.** During a rolling update, a browser that loaded version N can call into a pod running N+1. The template sets `deploymentId: process.env.NEXT_DEPLOYMENT_ID` and the Dockerfile passes the commit SHA as that build arg. Next then tags assets with `?dpl=` and hard-reloads the client when the server's id differs, instead of failing on a missing chunk or action. Next doesn't route by deployment; that would be the ingress's job, and we don't need it.
- **Caches are per pod.** See `caching.md`, "Multiple replicas".
- **Graceful shutdown.** On SIGTERM the server stops accepting connections and finishes in-flight requests and `after()` callbacks. The chart's `terminationGracePeriodSeconds` covers that; keep it above your longest request.

## Environment

| Kind | Example | Where it's set | When it's read |
|---|---|---|---|
| Build-time public | `NEXT_PUBLIC_APP_NAME` | Dockerfile `ARG`, from the workflow | Inlined at `next build`, same in every environment |
| Build-time private | `NEXT_DEPLOYMENT_ID` | Dockerfile `ARG` | `next build` |
| Runtime config | `API_BASE_URL`, `OTEL_EXPORTER_OTLP_ENDPOINT` | Chart ConfigMap → `envFrom` | Server, per request/process |
| Runtime secret | `DATABASE_URL`, `SESSION_SECRET` | Existing Kubernetes Secret → `envFrom` | Server only |

`src/env.ts` parses `process.env` with valibot once and exports a typed object; import it only from server code (`import "server-only"` at its top). A missing required variable then fails at start-up, not on the first request that needs it. Read it lazily (inside a function) so `next build` doesn't need runtime secrets.

## Streaming behind a proxy

Streaming responses need the ingress not to buffer. ingress-nginx buffers by default; the chart's ingress values include `nginx.ingress.kubernetes.io/proxy-buffering: "off"` as a commented example. Next sets `X-Accel-Buffering: no` for streamed responses, which nginx also honours.

## Images

`next/image` optimisation works out of the box: `sharp` is an optional dependency of `next` and pnpm installs the musl build when `pnpm install` runs inside the Alpine stage. Optimised images are cached in `.next/cache/images` (the `emptyDir`), so each pod re-optimises after a restart. Fine for app UIs; put a CDN in front if images are a large share of traffic.
