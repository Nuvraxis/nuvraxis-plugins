# The reference Dockerfile

This is the template's `apps/__APP__/Dockerfile`, byte for byte (`__APP__` is replaced by the app name at scaffold time). `scripts/check-skills.mjs` in the plugin repo fails CI if the two drift apart, so change the template and this copy together.

<!-- template: apps/__APP__/Dockerfile -->
```dockerfile
# syntax=docker/dockerfile:1
#
# Next.js standalone image for apps/__APP__ in a pnpm + Turborepo monorepo.
# Build from the repo root:  docker build -f apps/__APP__/Dockerfile -t __APP__ .
# Run:                       docker run --rm -p 3000:3000 __APP__

# Node: exact version (matches .node-version) pinned by multi-arch index digest.
ARG NODE_IMAGE=node:26.12.0-alpine3.24@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5

# ---- base: Node + pnpm (standalone binary, checksum-verified; no npm, no Corepack) ----
FROM ${NODE_IMAGE} AS base
# Keep PNPM_VERSION equal to "packageManager" in package.json. The checksums are the
# GitHub release assets pnpm-linux-{x64,arm64}-musl.tar.gz for that version.
ARG PNPM_VERSION=12.14.0
ARG PNPM_SHA256_AMD64=d7115e2f2791d79bf9e7e448609537595bb7787de1ef5292ce91ff3d1be2629e
ARG PNPM_SHA256_ARM64=511a54809bdfd28270d30011d1697f582c8130d555b4fa0e2856b1a7534c98bf
ARG TARGETARCH
RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) arch=x64; sha="${PNPM_SHA256_AMD64}" ;; \
      arm64) arch=arm64; sha="${PNPM_SHA256_ARM64}" ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    wget -qO /tmp/pnpm.tar.gz "https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-linux-${arch}-musl.tar.gz"; \
    echo "${sha}  /tmp/pnpm.tar.gz" | sha256sum -c -; \
    mkdir -p /opt/pnpm; \
    tar -xzf /tmp/pnpm.tar.gz -C /opt/pnpm; \
    rm /tmp/pnpm.tar.gz; \
    ln -s /opt/pnpm/pnpm /usr/local/bin/pnpm; \
    pnpm --version
ENV pnpm_config_store_dir=/pnpm/store \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1
WORKDIR /repo

# ---- pruner: a copy of the monorepo with only __APP__ and what it depends on ----
FROM base AS pruner
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm dlx "turbo@$(node -p 'require("./package.json").devDependencies.turbo')" prune __APP__ --docker

# ---- deps: install from the lockfile; this layer is reused until a manifest changes ----
FROM base AS deps
COPY --from=pruner /repo/out/json/ .
COPY --from=pruner /repo/out/pnpm-lock.yaml ./pnpm-lock.yaml
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch && pnpm install --frozen-lockfile --offline

# ---- builder ----
FROM deps AS builder
COPY --from=pruner /repo/out/full/ .
# Only NEXT_PUBLIC_* values and the deployment id are build arguments: they're inlined at
# build time. Runtime configuration and secrets come from the environment in Kubernetes.
ARG NEXT_DEPLOYMENT_ID
ENV NEXT_DEPLOYMENT_ID=${NEXT_DEPLOYMENT_ID}
# Optional BuildKit secret, only needed if the same commit is built more than once and served
# together (see the nextjs-production skill, references/self-hosting.md).
RUN --mount=type=secret,id=next_server_actions_key,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY \
    pnpm exec turbo run build --filter=__APP__

# ---- runner: standalone output only, non-root ----
FROM ${NODE_IMAGE} AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs -H -s /sbin/nologin nextjs
# Files stay owned by root and read-only to the app. Only .next/cache is writable; in
# Kubernetes it's an emptyDir so the root filesystem can be read-only.
COPY --from=builder /repo/apps/__APP__/.next/standalone ./
COPY --from=builder /repo/apps/__APP__/.next/static ./apps/__APP__/.next/static
COPY --from=builder /repo/apps/__APP__/public ./apps/__APP__/public
RUN mkdir -p apps/__APP__/.next/cache && chown 1001:1001 apps/__APP__/.next/cache
LABEL org.opencontainers.image.title="__APP__" \
      org.opencontainers.image.licenses="UNLICENSED"
USER 1001:1001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
    CMD wget -qO /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/__APP__/server.js"]
```

## Notes, stage by stage

**`ARG NODE_IMAGE`** is declared before the first `FROM`, so both `base` and `runner` use the same image. To bump Node: update `.node-version`, then the tag and digest here (`docker buildx imagetools inspect node:<version>-alpine<alpine>` prints the index digest), then CI's `setup-node` picks up `.node-version` by itself.

**`base`** installs pnpm into `/opt/pnpm` (the tarball holds the binary and a `dist/` folder it needs beside it) and links it onto `PATH`. `sha256sum -c` fails the build on any mismatch. Telemetry for Next and Turbo is off for every stage.

**`pruner`** copies the whole context (already filtered by `.dockerignore`) and runs turbo through `pnpm dlx`, at the exact version in the root `package.json`, so there's one place to bump turbo. Its output:

```
out/json/            package.json of the root and of each kept workspace package, pnpm-workspace.yaml
out/full/            their full sources
out/pnpm-lock.yaml   the lockfile, pruned to what's kept
```

**`deps`** copies only manifests and the lockfile. `pnpm fetch` downloads every package in the lockfile into the cache-mounted store; `pnpm install --offline` links them without touching the network. Neither layer changes when source files change.

**`builder`** adds the sources and builds through turbo, so `^build` dependencies (if any package emits) run first. `NEXT_DEPLOYMENT_ID` is a build arg because Next inlines it. The secret mount is a no-op when no secret is passed.

**`runner`** starts again from the pinned Node image. Only the standalone server, its traced `node_modules`, the static assets and `public` are copied. The cache directory is the one writable path.

## Adding a `NEXT_PUBLIC_` value

```dockerfile
# in builder, before the RUN that builds
ARG NEXT_PUBLIC_APP_NAME
ENV NEXT_PUBLIC_APP_NAME=${NEXT_PUBLIC_APP_NAME}
```

And in `main.yaml` / `pr.yaml`:

```yaml
build-args: |
  NEXT_DEPLOYMENT_ID=${{ github.sha }}
  NEXT_PUBLIC_APP_NAME=${{ vars.NEXT_PUBLIC_APP_NAME }}
```

## A private npm registry

Add the token as a secret mount on the `fetch` step and an `.npmrc` with only the registry and `${NPM_TOKEN}` auth line (pnpm reads auth from `.npmrc`):

```dockerfile
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    --mount=type=secret,id=npm_token,env=NPM_TOKEN \
    pnpm fetch && pnpm install --frozen-lockfile --offline
```

```yaml
# build-push-action
secrets: |
  npm_token=${{ secrets.NPM_TOKEN }}
```
