# stylelint for SCSS

Biome 2.5 doesn't parse SCSS (it's listed as in progress), so SCSS gets stylelint and nothing else. No Prettier: stylelint's `--fix` covers what the standard config can fix, and Biome formats everything else.

## Packages (repo root devDependencies)

| Package | Version | Note |
|---|---|---|
| `stylelint` | 17.x | ESM only, Node ≥ 20.19 |
| `stylelint-config-standard-scss` | 17.x | includes `stylelint-config-standard` and `stylelint-config-recommended-scss` |
| `postcss` | 8.x | peer of the SCSS config; install it explicitly |

Versions are pinned through the workspace `catalog:` (see `pnpm-turborepo`).

## `stylelint.config.mjs` (repo root, identical to the template)

<!-- template: stylelint.config.mjs -->
```js
// BEM in kebab-case: block, block__element, block--modifier, block__element--modifier.
const kebab = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*";

/** @type {import("stylelint").Config} */
export default {
  extends: ["stylelint-config-standard-scss"],
  rules: {
    "selector-class-pattern": [
      `^${kebab}(?:__${kebab})?(?:--${kebab})?$`,
      {
        message: (selector) =>
          `Expected "${selector}" to be BEM: block__element--modifier in kebab-case`,
      },
    ],
    // stylelint 17 dropped resolveNestedSelectors, so nested `&…` suffixes are checked here.
    "selector-disallowed-list": [
      [new RegExp(`^&(?!(?:__${kebab})?(?:--${kebab})?(?:$|[:\\[]))`), /\.nuv-/],
      {
        splitList: true,
        message: (selector) =>
          selector.includes(".nuv-")
            ? `Don't select nuvui's classes ("${selector}"): set the component's --nuv-* variable instead`
            : `Expected "${selector}" to nest as &__element, &--modifier or &__element--modifier`,
      },
    ],
    "max-nesting-depth": [
      1,
      {
        ignore: ["pseudo-classes", "blockless-at-rules"],
        ignoreAtRules: ["include", "media", "supports", "container"],
      },
    ],
    "selector-max-id": 0,
    "selector-no-qualifying-type": true,
    "declaration-no-important": true,
    "color-no-hex": true,
    "color-named": "never",
    "at-rule-disallowed-list": ["import"],
  },
};
```

What each addition catches:

| Rule | Catches |
|---|---|
| `selector-class-pattern` | `.cardTitle`, `.card__title__icon`, `.Card` at the top level |
| `selector-disallowed-list` (1st) | Nested `&__Title`, `&_x`, `&-x`, `& .other-block`, `&.is-active` (state is a `--modifier`) |
| `selector-disallowed-list` (2nd) | `.toolbar .nuv-button` |
| `max-nesting-depth: 1` | `&__header { &__title {} }`, `&__title { &--large {} }`, `.block { .child {} }` |
| `color-no-hex`, `color-named` | `#16a34a`, `red`: every color is a token |
| `declaration-no-important` | `!important` |
| `at-rule-disallowed-list` | `@import` |

Pseudo-classes and `@include`/`@media` blocks don't count toward the depth, so `&__title { &:hover {} }` and `@include nuv.breakpoint("md") {}` inside an element are fine.

## Running it

```sh
pnpm exec stylelint "**/*.scss" --allow-empty-input          # check (CI)
pnpm exec stylelint "**/*.scss" --allow-empty-input --fix    # fix what can be fixed
```

`--allow-empty-input` keeps a repo with no SCSS yet green. `node_modules` is ignored by default; build output contains no `.scss`. stylelint 17 dropped the built-in GitHub formatter, so CI uses the default output.

## VS Code

Recommend `stylelint.vscode-stylelint` in `.vscode/extensions.json` and set:

```json
{
  "stylelint.validate": ["scss"],
  "[scss]": { "editor.defaultFormatter": "stylelint.vscode-stylelint", "editor.codeActionsOnSave": { "source.fixAll.stylelint": "explicit" } }
}
```

The template's `.vscode/settings.json` already has this next to the Biome settings.

## When a rule is wrong for a file

Disable it on the line with the reason, never for the whole file:

```scss
// stylelint-disable-next-line declaration-no-important -- overrides a third-party widget's inline style
```
