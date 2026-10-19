---
name: docker-nextjs
description: >-
  Dockerfile rules for Next.js standalone apps in a pnpm + Turborepo monorepo — multi-stage build (turbo prune → pnpm fetch/offline install → turbo build → minimal runner), pinned Node 26 Alpine by digest, checksum-verified pnpm binary, non-root uid 1001, read-only root filesystem with a writable .next/cache, HEALTHCHECK on /api/health, build args only for NEXT_PUBLIC_* values, BuildKit secrets and cache mounts, multi-arch, OCI labels and .dockerignore. Use when the repo has a Dockerfile, .dockerignore, compose file, or next.config with output "standalone", or when asked to containerise, shrink, harden or debug an image.
when_to_use: >-
  "write a Dockerfile", "the image is too big", "docker build fails", "run it in a container", "make it run as non-root", "read-only filesystem", "add a build arg", "the env var is wrong in the container".
---

# Docker for Next.js

Use for the app image. Next-side standalone facts are in `nextjs-production` (`references/self-hosting.md`); what runs the image in Kubernetes is `helm-nextjs`; how CI builds and pushes it is `github-actions`.

The template's `apps/<app>/Dockerfile` is the source of truth; [references/Dockerfile.md](references/Dockerfile.md) has it in full with notes. Build from the **repo root**: `docker build -f apps/<app>/Dockerfile -t <app> .`

## Rules

1. **Five stages: `base` → `pruner` → `deps` → `builder` → `runner`.**
   - `base`: Node + pnpm, nothing else.
   - `pruner`: `turbo prune <app> --docker` on the full repo, leaving only the app and its workspace dependencies.
   - `deps`: copy only `out/json/` (manifests) and `out/pnpm-lock.yaml`, then `pnpm fetch` + `pnpm install --frozen-lockfile --offline`. This layer is reused until a manifest or the lockfile changes, so a source edit doesn't reinstall.
   - `builder`: copy `out/full/` (sources), `pnpm exec turbo run build --filter=<app>`.
   - `runner`: a fresh Node image with only the standalone output.
   Why: source changes rebuild only the last two stages, and the runner has no pnpm, no sources, no dev dependencies.

2. **Pin the Node image by exact version and digest, matching `.node-version`.**
   `node:26.12.0-alpine3.24@sha256:6f08…` in one `ARG NODE_IMAGE`, used by both `base` and `runner`. The digest is the multi-arch index, so amd64 and arm64 both resolve.
   Why Alpine over distroless: distroless Node publishes only floating tags (`latest`, `nonroot`), so the exact Node version can't be matched to `.node-version`, and it has no `wget` for the HEALTHCHECK. Alpine is small, pins exactly, and `sharp` ships prebuilt musl binaries, so image optimisation works without extra packages.

3. **Install pnpm from the GitHub release binary, verified by SHA-256. Never `npm i -g pnpm`, never Corepack, never a downloaded install script piped into a shell.**
   One `ARG PNPM_VERSION` equal to `packageManager`, plus one checksum per architecture for `pnpm-linux-{x64,arm64}-musl.tar.gz`, selected by `TARGETARCH`. To bump: change the three ARGs, taking the sha256 values from the release's asset digests (`gh release view v<version> --repo pnpm/pnpm --json assets`), and bump `packageManager` in the same commit. Fallback if the release format changes: base the `pruner`/`deps`/`builder` stages on `ghcr.io/pnpm/pnpm:<version>` (no Node, add it) rather than inventing a new install method.

4. **The runner copies exactly three things.**
   ```dockerfile
   COPY --from=builder /repo/apps/<app>/.next/standalone ./
   COPY --from=builder /repo/apps/<app>/.next/static ./apps/<app>/.next/static
   COPY --from=builder /repo/apps/<app>/public ./apps/<app>/public
   ```
   Standalone doesn't include `static` or `public`; without them the app serves no JS or CSS. In the monorepo the server is `apps/<app>/server.js`. `CMD ["node", "apps/<app>/server.js"]`, exec form, so Node gets SIGTERM directly.

5. **Run as uid/gid 1001 with files owned by root.**
   Create `nextjs:nodejs` (1001:1001), leave the copied files root-owned (the app can read but not change its own code), and `chown` only `apps/<app>/.next/cache`. `USER 1001:1001`, numeric, so Kubernetes can verify `runAsNonRoot` without resolving names.

6. **The image must work with a read-only root filesystem.**
   The only runtime writes go to `.next/cache` (image optimisation, ISR/fetch cache). Kubernetes mounts an `emptyDir` there; locally use `--tmpfs`. Test it:
   ```sh
   docker run --rm -p 3000:3000 --read-only \
     --tmpfs /app/apps/<app>/.next/cache:uid=1001,gid=1001 \
     --cap-drop ALL --security-opt no-new-privileges <app>
   ```

7. **Set `NODE_ENV=production`, `HOSTNAME=0.0.0.0`, `PORT=3000`, `NEXT_TELEMETRY_DISABLED=1` in the runner.** Without `HOSTNAME=0.0.0.0` the standalone server binds to the container hostname and probes fail.

8. **`HEALTHCHECK` hits `/api/health` with busybox `wget`.** It's for `docker run`/Compose; Kubernetes ignores it and uses the chart's probes on the same path.

9. **Build args are only for values inlined at build: `NEXT_PUBLIC_*` and `NEXT_DEPLOYMENT_ID`.**
   `NEXT_PUBLIC_*` is compiled into the JS, so it must be an `ARG` + `ENV` in `builder`, and it's identical in every environment the image runs in. Everything per-environment is a runtime env var from the chart. To add one:
   ```dockerfile
   ARG NEXT_PUBLIC_APP_NAME
   ENV NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME}
   ```
   …plus `build-args` in both workflows and `NEXT_PUBLIC_*` is already in turbo's `env`.

10. **Secrets never go in an `ARG`, `ENV` or `COPY`.** They'd stay in the image history. Use a BuildKit secret mount, which exists only for that `RUN`:
    ```dockerfile
    RUN --mount=type=secret,id=npmrc,target=/root/.npmrc pnpm fetch   # private registry: the .npmrc exists only for this RUN
    ```
    The template's build step already declares the optional `next_server_actions_key` secret this way.

11. **Cache the pnpm store with a BuildKit cache mount.** `--mount=type=cache,id=pnpm-store,target=/pnpm/store` on `fetch`/`install`/`dlx`, with `pnpm_config_store_dir=/pnpm/store`. The store survives between builds on the same builder without landing in a layer. In CI, layer caching is `type=gha` (see `github-actions`).

12. **`.dockerignore` at the repo root keeps the context small and secrets out.** It excludes `node_modules`, `.next`, `.turbo`, `dist`, `coverage`, `.env*`, `.git`, `.github`, `charts`. A context that includes `node_modules` from Windows or macOS breaks native packages in the Linux image.

13. **Multi-arch is `linux/amd64,linux/arm64`, built by CI.** Locally, build your own architecture. Every stage is architecture-neutral except the pnpm download, which picks its checksum from `TARGETARCH`.

14. **Labels:** the Dockerfile sets `org.opencontainers.image.title` and `licenses`; CI adds `source`, `revision`, `version`, `created` through `docker/metadata-action`. Don't hard-code a version label.

15. **Keep stages free of app-specific hacks.** No `apk add` in the runner (the app doesn't need a shell toolset), no `npm`, no `node_modules` copied from the host. If the app needs a native tool at runtime, justify it in a comment.

## Debugging

| Symptom | Cause |
|---|---|
| `extends: … doesn't resolve` during build | A root-level file the app needs wasn't in the pruned tree: move it into a workspace package |
| `ERR_PNPM_OUTDATED_LOCKFILE` in `deps` | Lockfile not committed after a manifest change |
| `ERR_PNPM_IGNORED_BUILDS` | A new dependency wants an install script: decide in `allowBuilds` |
| App starts, no CSS/JS | `.next/static` or `public` not copied to `apps/<app>/` |
| Health check fails, logs fine | `HOSTNAME` not `0.0.0.0` |
| `EROFS` at runtime | Something writes outside `.next/cache`; find it, don't drop `--read-only` |
| `NEXT_PUBLIC_X` empty | Not passed as a build arg (it's baked at build) |

## Verify

```sh
docker build -f apps/<app>/Dockerfile -t <app>:local --build-arg NEXT_DEPLOYMENT_ID=local .
docker run -d --name <app> -p 3000:3000 --read-only --tmpfs /app/apps/<app>/.next/cache:uid=1001,gid=1001 --cap-drop ALL <app>:local
curl -fsS localhost:3000/api/health
docker exec <app> id                     # uid=1001(nextjs)
docker inspect --format '{{.State.Health.Status}}' <app>   # healthy after ~30s
docker rm -f <app>
```

## Sources

- https://nextjs.org/docs/app/api-reference/config/next-config-js/output
- https://nextjs.org/docs/app/guides/self-hosting
- https://turborepo.dev/docs/guides/tools/docker
- https://pnpm.io/docker
- https://pnpm.io/cli/fetch
- https://github.com/pnpm/pnpm/releases
- https://docs.docker.com/build/building/best-practices/
- https://docs.docker.com/build/building/secrets/
- https://docs.docker.com/build/cache/optimize/#use-cache-mounts
- https://docs.docker.com/reference/dockerfile/#healthcheck
- https://hub.docker.com/_/node
- https://github.com/opencontainers/image-spec/blob/main/annotations.md
