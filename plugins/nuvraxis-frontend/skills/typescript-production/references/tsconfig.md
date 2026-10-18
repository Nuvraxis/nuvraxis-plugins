# tsconfig layering

```
packages/tsconfig/
├─ package.json      # "@repo/tsconfig", private
└─ base.json         # strict compiler options shared by every package
apps/<app>/tsconfig.json          # extends @repo/tsconfig/base.json, adds DOM + JSX + Next types
packages/<lib>/tsconfig.json      # extends @repo/tsconfig/base.json, adds what the lib needs
```

Why a workspace package and not a root `tsconfig.base.json`: `turbo prune --docker` copies only the workspace packages an app depends on, not loose root files. With the base in a package that the app lists as `"@repo/tsconfig": "workspace:*"`, the Docker build has it automatically.

## `packages/tsconfig/base.json` (template)

<!-- template: packages/tsconfig/base.json -->
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "moduleDetection": "force",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": []
  }
}
```

- `moduleResolution: "bundler"`: everything here is compiled by Next/Turbopack, so imports follow bundler rules (no `.js` extensions in relative imports).
- `noEmit`: type-checking only; Next (SWC) does the transpiling.
- `types: []` is TS 7's default anyway; stating it makes each package opt in to `node` explicitly.

## The Next app (template)

```json
{
  "extends": "@repo/tsconfig/base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "jsx": "react-jsx",
    "incremental": true,
    "types": ["node"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "src/**/*.ts", "src/**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next build` leaves this file untouched; if Next ever rewrites it, accept its change in the app's file, not in the base.

## Source-only internal package (default)

```json
// packages/api-client/package.json
{
  "name": "@repo/api-client",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "typecheck": "tsc --noEmit" },
  "devDependencies": { "@repo/tsconfig": "workspace:*", "typescript": "catalog:" }
}
```

```json
// packages/api-client/tsconfig.json
{ "extends": "@repo/tsconfig/base.json", "compilerOptions": { "lib": ["esnext", "dom"] }, "include": ["src"] }
```

The app depends on it with `"@repo/api-client": "workspace:*"`. No build, no `dist`, no project references: the app's `tsc` reads the source through `exports`.

## A package that emits (published, or run directly by Node)

```json
{
  "extends": "@repo/tsconfig/base.json",
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "noEmit": false,
    "rootDir": "src",
    "outDir": "dist",
    "declaration": true,
    "declarationMap": true,
    "isolatedDeclarations": true,
    "erasableSyntaxOnly": true,
    "composite": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

```json
"exports": {
  ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
},
"scripts": { "build": "tsc -b", "typecheck": "tsc -b --noEmit" }
```

- `nodenext` because Node runs the output: relative imports need `.js` extensions.
- `rootDir` must be set when emitting (TS 7 errors otherwise with sources under `src/`).
- `composite` + `tsc -b` give incremental builds and project references between emitting packages. Add `"references": [{ "path": "../other" }]` only between emitting packages.
- Turbo's `build` task already runs `^build` first, so dependents see fresh `dist/`.

## Checking a config change

```sh
pnpm exec tsc --showConfig -p apps/<app>   # the fully resolved options
pnpm typecheck
```
