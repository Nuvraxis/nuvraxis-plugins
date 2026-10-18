---
name: typescript-production
description: >-
  TypeScript 7 rules for Nuvraxis monorepos — strict tsconfig layering (packages/tsconfig), exactOptionalPropertyTypes and noUncheckedIndexedAccess, discriminated unions, branded ids, unknown over any, import type, as-const objects instead of enums, valibot parsing at the edges, Result types at boundaries, package exports maps, and type tests with expectTypeOf. Use when writing or reviewing .ts/.tsx files, any tsconfig.json, a package.json "exports" field, or when "typescript" or "valibot" is in package.json and the task involves types, validation or compiler errors.
when_to_use: >-
  "fix this type error", "add types", "validate this input", "create a shared package", "tsconfig", "why does tsc complain", "model this state", "add a type test".
---

# TypeScript in production

Use for type design, validation and compiler configuration in any package of the monorepo. Next-specific typing (`PageProps`, typed routes) is in `nextjs-production`; workspace wiring in `pnpm-turborepo`.

Baseline: **TypeScript 7.0** (`typescript` package, native `tsc`), strict by default. The shared config is `packages/tsconfig/base.json` in the template.

## Rules

1. **Extend `@repo/tsconfig/base.json`; never loosen it per package.**
   Every package's `tsconfig.json` extends the base and only adds what its runtime needs (`lib`, `jsx`, `types`, `paths`). Turning off a strict flag in one package hides bugs at the boundary with the others. Layering and the library variant: [references/tsconfig.md](references/tsconfig.md).

2. **Keep the strict extras on: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`.**
   ```ts
   const first = items[0];        // Item | undefined: handle it
   if (!first) return notFound();

   type Patch = { name?: string }; // "absent", not "present and undefined"
   const p: Patch = { name: undefined };            // error under exactOptionalPropertyTypes
   const q: Patch = input.name ? { name: input.name } : {}; // right
   ```
   For optional props fed from possibly-undefined values, spread conditionally: `...(x ? { x } : {})`.

3. **`unknown`, never `any`.** Data from outside (JSON, `FormData`, env, `catch (e)`) is `unknown` until parsed. Biome's `noExplicitAny` is on; a `// biome-ignore` needs a reason that names the external type you can't fix.

4. **Parse at the edges with valibot; trust types inside.**
   One schema per boundary (form, route body, env, third-party response), parsed once where data enters. Inside, pass the parsed type and never re-validate.
   Why valibot over zod: it's modular and tree-shakes to a few hundred bytes per schema, which matters because the same schema validates forms in the browser and actions on the server. zod would also work; don't mix the two in one repo.
   ```ts
   import * as v from "valibot";

   export const InviteInput = v.object({
     email: v.pipe(v.string(), v.trim(), v.email()),
     role: v.picklist(["admin", "member", "viewer"]),
   });
   export type InviteInput = v.InferOutput<typeof InviteInput>;

   const result = v.safeParse(InviteInput, Object.fromEntries(form));
   if (!result.success) return { ok: false, issues: v.flatten(result.issues).nested };
   ```

5. **Model states with discriminated unions, not boolean flags.**
   ```ts
   // Wrong: 2^3 combinations, most of them impossible
   type Load = { loading: boolean; error?: string; data?: Invoice[] };

   // Right
   type Load =
     | { status: "loading" }
     | { status: "error"; error: string }
     | { status: "ready"; data: Invoice[] };
   ```
   Switch on the tag and end with an exhaustiveness check: `default: return assertNever(state)`.

6. **Brand ids so they can't be swapped.**
   ```ts
   declare const brand: unique symbol;
   type Brand<T, B extends string> = T & { readonly [brand]: B };
   export type InvoiceId = Brand<string, "InvoiceId">;
   export type OrgId = Brand<string, "OrgId">;
   ```
   Create them only in the parser (`v.pipe(v.string(), v.uuid(), v.brand("InvoiceId"))`) or the data layer. A function taking `(invoiceId: InvoiceId, orgId: OrgId)` then can't be called with the arguments swapped.

7. **No `enum`. Use `as const` objects or string unions.**
   Enums emit runtime code, aren't erasable (they break Node type stripping and `erasableSyntaxOnly`), and numeric ones accept any number.
   ```ts
   export const Role = { Admin: "admin", Member: "member", Viewer: "viewer" } as const;
   export type Role = (typeof Role)[keyof typeof Role];
   ```
   Same reasoning: no `namespace`, no parameter properties in constructors.

8. **`import type` for types.** `verbatimModuleSyntax` makes a type-only import that isn't marked an error. Biome's `useImportType` fixes it automatically.

9. **`satisfies` for config objects; annotations for function boundaries.**
   ```ts
   const routes = { home: "/", invoices: "/invoices" } satisfies Record<string, `/${string}`>;
   // keeps the literal types of each key, still checks the shape
   ```
   Exported functions get explicit return types where the inferred one would leak an implementation detail (always, in libraries: see rule 13).

10. **Return results at boundaries; throw for bugs.**
    Expected failures a caller must handle (validation failed, not found, forbidden, conflict) are returned as `{ ok: false, error: "…" }` from Server Actions, data functions and API clients. Throw only for programmer errors and broken invariants, and let `error.tsx` + `onRequestError` catch them. Don't wrap everything in a Result library.
    ```ts
    type Result<T, E extends string> = { ok: true; value: T } | { ok: false; error: E };
    ```

11. **Narrow `catch` values.** `catch (error)` gives `unknown`. Use `error instanceof Error ? error.message : String(error)` for logs, and never show it to users.

12. **Internal packages export TypeScript source through an `exports` map.**
    ```json
    { "name": "@repo/api-client", "type": "module", "exports": { ".": "./src/index.ts" } }
    ```
    The Next app compiles it (add it to `transpilePackages` if Next doesn't pick it up) and `tsc --noEmit` checks it with the app. No build step, no `dist`, no project references. Only packages that are published or run directly by Node get a build; see [references/tsconfig.md](references/tsconfig.md).

13. **Packages that emit declarations use `isolatedDeclarations`.** Every export then needs an explicit type, which keeps declaration emit fast and the public API deliberate.

14. **Test types with `expectTypeOf` from vitest.**
    ```ts
    // money.test-d.ts
    import { expectTypeOf, test } from "vitest";
    test("parse returns branded ids", () => {
      expectTypeOf(parseInvoiceId("…")).toEqualTypeOf<InvoiceId>();
      expectTypeOf<InvoiceId>().not.toEqualTypeOf<OrgId>();
    });
    ```
    Run with `vitest --typecheck` (vitest 5 works with TS 7's `tsc`). Write type tests for public helpers and generic utilities, not for app code.

15. **Know what TypeScript 7 doesn't do yet.**
    - No JS compiler API, no language-service plugins: the Next.js editor plugin (`{"name": "next"}`) doesn't load, so it's not in the template. `typedRoutes` covers link checking at compile time.
    - `next build` type-checks by running the project's `tsc` (`experimental.useTypeScriptCli: true` in the template). Diagnostics are plain `tsc` output.
    - typescript-eslint doesn't support TS 7. We lint with Biome, so it doesn't matter; if a tool insists on the TS API, alias TS 6 for it as in the TS 7 release notes.
    - Removed options fail the build: `target: es5`, `moduleResolution: node`/`node10`/`classic`, `baseUrl` (use `paths` relative to the tsconfig), `outFile`, `module: amd|umd|system`, `esModuleInterop: false`. Import `asserts` → `with`.
    - New defaults: `strict: true`, `types: []` (so add `"types": ["node"]` where Node globals are used), `noUncheckedSideEffectImports: true`. Set `rootDir` whenever you emit.

## Verify

```sh
pnpm typecheck                 # turbo run typecheck → next typegen && tsc --noEmit per package
pnpm lint                      # Biome: noExplicitAny, useImportType, …
pnpm exec vitest --typecheck --run   # where type tests exist
pnpm build
```

## Sources

- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- https://www.typescriptlang.org/tsconfig/
- https://www.typescriptlang.org/tsconfig/#exactOptionalPropertyTypes
- https://www.typescriptlang.org/tsconfig/#noUncheckedIndexedAccess
- https://www.typescriptlang.org/tsconfig/#verbatimModuleSyntax
- https://www.typescriptlang.org/tsconfig/#isolatedDeclarations
- https://nextjs.org/docs/app/api-reference/config/typescript
- https://nextjs.org/docs/app/api-reference/config/next-config-js/useTypeScriptCli
- https://valibot.dev/guides/introduction/
- https://vitest.dev/guide/testing-types
- https://nodejs.org/api/packages.html#exports
