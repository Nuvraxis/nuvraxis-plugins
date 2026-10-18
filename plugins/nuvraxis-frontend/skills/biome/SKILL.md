---
name: biome
description: >-
  Biome 2.5 setup and rules for Nuvraxis monorepos — root biome.json with pinned $schema, VCS ignore, formatter settings, the recommended preset with a11y and the react/next domains, nursery policy, organize imports, overrides, nested per-package configs ("extends": "//"), biome check --write locally, biome ci in CI, VS Code settings, and migrating from ESLint/Prettier. Use when the repo has biome.json or biome.jsonc, @biomejs/biome in package.json, .eslintrc*/eslint.config.*/.prettierrc* to migrate, or when fixing lint and formatting errors.
when_to_use: >-
  "set up linting", "fix lint errors", "format the code", "remove eslint", "migrate from prettier", "biome says…", "ignore this rule", "configure biome for the monorepo".
---

# Biome

Biome is the only formatter and linter for JS, TS, JSX, JSON and CSS. SCSS is the exception: Biome 2.5 doesn't parse it, so stylelint handles `.scss` (see `scss-bem`). No ESLint, no Prettier.

The template's root `biome.json` is the source of truth. A plugin hook runs `pnpm exec biome check --write <file>` after every file Claude edits, when a `biome.json` exists above it.

## Rules

1. **One root `biome.json`, schema pinned to the installed version.**
   `"$schema": "https://biomejs.dev/schemas/2.5.15/schema.json"`, and `@biomejs/biome` pinned to the same version in the workspace catalog. A mismatched schema hides unknown or renamed options in the editor. When upgrading, run `pnpm exec biome migrate --write` and update both.

2. **Let git decide what's ignored: `vcs.useIgnoreFile: true`.** Then force-ignore build output with `!!` in `files.includes` (`!!**/.next`, `!!**/.turbo`, `!!**/dist`, `!!**/coverage`), which also stops Biome from scanning those folders. A single `!` excludes from processing but still indexes. `files.ignoreUnknown: true` keeps `.scss` and other unsupported files from being reported.

3. **Formatter: 2 spaces, width 100, LF, double quotes, semicolons, trailing commas.** These are fixed for every repo so diffs don't fight over style. Don't add per-package formatter overrides.

4. **Linter: `preset: "recommended"`, `a11y: "error"`, domains `react` and `next` at `recommended`.**
   `rules.recommended: true` is the old spelling and is deprecated: use `rules.preset`. `a11y` at `error` because nuvui handles its own components' accessibility, so what's left (`alt`, labels, button types in your own markup) must be right. The `next` domain adds rules like `noImgElement`; `react` adds hooks rules.

5. **Nursery stays off.** Nursery rules change between patch releases and can break CI on a Biome upgrade. Enable one deliberately, by name, with a comment saying why, and re-check on every upgrade.

6. **`noConsole` warns, allowing `error` and `warn`.** Structured error logs (`instrumentation.ts`) use `console.error`; stray `console.log` is caught.

7. **Sort imports with the assist, not by hand.** `assist.actions.source.organizeImports: "on"`. `biome check --write` applies it; `biome ci` fails on unsorted imports.

8. **Overrides by glob, for test files and the like.** The template enables the `test` domain only for `*.test.ts(x)` / `*.test-d.ts`. Put other file-type differences there too, not in separate configs.

9. **Nested configs only for packages that truly differ, and they extend the root.**
   ```json
   // packages/legacy-widget/biome.json
   { "extends": "//", "linter": { "rules": { "style": { "noNonNullAssertion": "off" } } } }
   ```
   `"extends": "//"` means "the root config" and implies `"root": false`. Any other nested config must set `"root": false`. We don't use a shared `@repo/biome-config` package: the root file plus `//` covers it without a build or a dependency.

10. **Locally `biome check --write`; in CI `biome ci`.**
    `pnpm lint` runs `biome check .` (no writes); `pnpm lint:fix` runs `biome check --write .`. CI runs `pnpm exec biome ci --reporter=github .`, which never writes, fails on formatting, lint and import order, and annotates the PR. Add `--changed --since=origin/main` only if the full run gets slow; it's milliseconds today.

11. **Suppress one line, with a reason.**
    ```ts
    // biome-ignore lint/suspicious/noExplicitAny: third-party callback typed as any upstream
    ```
    Never disable a rule repo-wide to make one file pass. If a rule is wrong for the repo, change `biome.json` in its own commit with the reason.

12. **Fix, don't silence, the common ones.**
    - `useImportType`: run the fix; it's required by `verbatimModuleSyntax`.
    - `noExplicitAny`: use `unknown` and parse (see `typescript-production`).
    - `useButtonType`, `noSvgWithoutTitle`, `useAltText`: real accessibility bugs.
    - `noImgElement`: use `next/image`.
    - `useExhaustiveDependencies`: fix the dependency list or move the value out of the component.

13. **VS Code: Biome is the default formatter, fixes on save.** The template's `.vscode/settings.json` sets `editor.defaultFormatter: "biomejs.biome"`, `source.fixAll.biome` and `source.organizeImports.biome` on save, and `biome.requireConfiguration: true` so the extension stays quiet in repos without Biome. SCSS keeps the stylelint extension. Recommend both in `.vscode/extensions.json`.

14. **Migrating from ESLint/Prettier: migrate, then delete.**
    See [references/migration.md](references/migration.md). End state: no `eslint*`, `prettier*` or `@typescript-eslint/*` packages, no `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, `.prettierignore`.

## What Biome doesn't cover

| File | Tool |
|---|---|
| `.scss` | stylelint (`scss-bem`) |
| `.yaml` (workflows, Helm) | actionlint for workflows; `helm lint` + kubeconform for charts |
| `.md` | nothing enforced |
| Type errors | `tsc --noEmit` (`pnpm typecheck`) |

## Verify

```sh
pnpm lint                               # biome check . && stylelint
pnpm exec biome ci --reporter=github .  # what CI runs
pnpm exec biome rage                    # prints the resolved config if something looks ignored
```

## Sources

- https://biomejs.dev/reference/configuration/
- https://biomejs.dev/guides/big-projects/
- https://biomejs.dev/linter/domains/
- https://biomejs.dev/linter/rules/
- https://biomejs.dev/reference/cli/
- https://biomejs.dev/reference/vscode/
- https://biomejs.dev/guides/migrate-eslint-prettier/
- https://biomejs.dev/internals/language-support/
