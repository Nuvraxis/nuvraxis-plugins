# turbo.json, explained

The template's file:

<!-- template: turbo.json -->
```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": [".next/**", "!.next/cache/**", "dist/**"],
      "env": ["NEXT_PUBLIC_*", "NEXT_DEPLOYMENT_ID", "NEXT_SERVER_ACTIONS_ENCRYPTION_KEY"],
      "passThroughEnv": ["NEXT_TELEMETRY_DISABLED"]
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "test": {
      "dependsOn": ["^build"],
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

| Key | Why it's set this way |
|---|---|
| `dependsOn: ["^build"]` | Dependencies build first. Source-only packages have no `build` script, so this costs nothing until a package starts emitting. |
| `outputs` for build | `.next/**` minus `.next/cache/**`: the cache folder is large and machine-specific; restoring it from turbo's cache would be wasted I/O. `dist/**` covers emitting packages. |
| `env` for build | Inlined at build: `NEXT_PUBLIC_*`, the deployment id, the optional Server Actions key. A change must produce a new cache entry. The secret is only hashed, never stored. |
| `passThroughEnv` | Available to the task, not part of the hash. |
| `typecheck` `outputs: []` | Nothing to restore; a cache hit just skips the run. |
| `test` `outputs: []` | Tests write no files by default. A package whose test script writes coverage adds `"coverage/**"` in its own `turbo.json` (package configuration), so turbo doesn't warn about missing outputs elsewhere. |
| `dev` | Never cached, long-running. |

No `globalDependencies`: the shared tsconfig is a workspace package, so a change to it already invalidates every dependent through the package graph.

## Inputs

The default inputs are all git-tracked files in the package. Narrow them only when a task provably ignores some files, e.g. a `test` task that shouldn't rerun on `.md` changes:

```json
"test": { "inputs": ["$TURBO_DEFAULT$", "!**/*.md"] }
```

Never narrow `build` inputs for a Next app: Next reads files you wouldn't expect (`public/`, `next.config.ts`, `.env*` if present).

## Environment variables and strict mode

Turbo passes only listed variables to tasks. Symptoms of a missing entry: a variable is `undefined` inside `next build` in CI but works locally with `--env-mode=loose`. Fix by adding it to the task's `env` (affects output) or `passThroughEnv` (doesn't). Runtime-only server variables never go here.

Biome's `turborepo` domain can flag undeclared variables in code; we don't enable it because most `process.env` reads in the app are runtime-only by design.

## Seeing what turbo will do

```sh
pnpm exec turbo run build --dry                    # tasks, hashes, cache status
pnpm exec turbo run build --summarize              # writes .turbo/runs/<id>.json after a run
pnpm exec turbo run build --affected --dry         # what CI would run on this branch
```

A cache miss you didn't expect: compare two `--summarize` files; the differing input or env var is listed.

## Remote cache

```yaml
# in a workflow job
env:
  TURBO_TOKEN: ${{ secrets.TURBO_TOKEN }}
  TURBO_TEAM: ${{ vars.TURBO_TEAM }}
```

Works with Vercel's remote cache or any server that implements the Remote Cache API. Leave it off until CI time matters; local caching already makes repeat runs fast.

## Adding a task

1. Add the script to each package that has it (`"lint:types": "…"`).
2. Add the task to `turbo.json` with `dependsOn`, `outputs` and `env`.
3. Add a root script `"lint:types": "turbo run lint:types"` if people should run it.
4. If CI should run it, add it to the `turbo run` line in `pr.yaml`.
