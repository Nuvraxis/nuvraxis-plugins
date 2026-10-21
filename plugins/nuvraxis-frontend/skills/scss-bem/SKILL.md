---
name: scss-bem
description: >-
  Writes and reviews SCSS for Nuvraxis Next.js apps with BEM class names (block__element--modifier), nuvui design tokens and stylelint. Use when creating or editing .scss files, adding styles to a React component, theming or dark mode, breakpoints, or a stylelint.config.mjs; also when package.json has sass, stylelint-config-standard-scss or @nuvui/react.
when_to_use: >-
  "style this component", "add a stylesheet", "make it responsive", "dark mode", "fix stylelint errors", "rename these classes to BEM", any change under src/styles/ or to a *.scss file.
---

# SCSS + BEM

Use when writing or reviewing the app's own styles: the layout around nuvui components, screens, and blocks.
Don't use for restyling a nuvui component's internals (that's props and `--nuv-*` variables, see the `nuvui` skill, `rules/styling.md`) or for Tailwind projects.

Before writing a stylesheet, read nuvui first: the full checklist is in [nextjs-production](../nextjs-production/SKILL.md) under "Before writing any UI". For styles in particular: `get_rules` with topic `styling`, `get_page` for each component the block wraps (its CSS variables and classes), the block or chart you're starting from (`get_block` / `get_chart`), and `get_tokens` for every value.

Biome does not lint SCSS. stylelint does, with `stylelint-config-standard-scss` and the BEM pattern in [references/stylelint.md](references/stylelint.md). The template ships `stylelint.config.mjs` at the repo root.

## Rules

1. **Name every class `block__element--modifier`, in kebab-case.**
   Why: one flat naming scheme means no specificity fights and a class name tells you which file it lives in.
   ```scss
   // Wrong
   .invoiceCard .title.big {}
   .invoice-card__header__title {}   // element inside an element

   // Right
   .invoice-card {}
   .invoice-card__title {}
   .invoice-card__title--large {}
   ```
   An element belongs to the block, never to another element. `__header__title` becomes `__title` (or a new block if the header is reusable).

2. **One block per file, named after the block, beside the component that renders it.**
   `components/invoice-card/invoice-card.tsx` imports `./invoice-card.scss`, which defines `.invoice-card` and nothing else.
   Why: a block is found by its name, deleted with its component, and never collides with another file.

3. **Use global SCSS with BEM, not `.module.scss`.**
   The component does `import "./invoice-card.scss"` and writes `className="invoice-card__title"`.
   Why: BEM already scopes the names, so CSS Modules only add hashed names and `styles["invoice-card__title"]` lookups. Plain class names match how nuvui and its blocks are written, read the same in DevTools and in tests, and can be targeted by an ancestor setting a variable. App Router allows a global stylesheet import from any component; Turbopack bundles it with the route that uses it.
   The cost is that a duplicated block name collides silently, which is why rule 2 ties the name to the file.

4. **Nest only `&__element`, `&--modifier` and `&__element--modifier`, one level deep under the block.**
   ```scss
   // Wrong: descendant selectors and element-in-element
   .invoice-card {
     .title { span { … } }
     &__header { &__title { … } }   // compiles to .invoice-card__header__title
     &__title { &--large { … } }    // two levels: write &__title--large instead
   }

   // Right
   .invoice-card {
     display: grid;

     &__title { font-weight: var(--font-weight-semibold); }
     &__title--large { font-size: var(--text-lg); }
     &--overdue { border-color: var(--color-danger); }
   }
   ```
   Pseudo-classes (`&:hover`, `&:focus-visible`), `@include` and `@media` can nest anywhere. stylelint 17 no longer resolves nested selectors for `selector-class-pattern`, so the config checks the `&` suffix with `selector-disallowed-list` and the depth with `max-nesting-depth: 1`.

5. **Put a modifier on the block or element it changes, and keep the base class.**
   `className="invoice-card invoice-card--overdue"`, never `invoice-card--overdue` alone. To style an element from a block modifier, write `.invoice-card--overdue .invoice-card__total`, the only descendant selector BEM allows.
   For conditional classes, build the string with a small helper or a template literal; don't add a dependency for it.

6. **`@use` and `@forward`, never `@import`.**
   Why: `@import` is deprecated in Dart Sass and will be removed; it also leaks every variable globally and duplicates CSS when imported twice.
   ```scss
   @use "@nuvui/react/scss/mixins" as nuv;
   @use "abstracts" as a; // src/styles/abstracts/_index.scss, via sassOptions.loadPaths
   ```

7. **Every color, space, radius and font size is a CSS custom property from nuvui's tokens.**
   ```scss
   // Wrong
   .invoice-card { color: #16a34a; padding: 16px; border-radius: 8px; }

   // Right
   .invoice-card {
     color: var(--color-success);
     padding: calc(var(--spacing) * 4);
     border-radius: var(--radius-md);
   }
   ```
   Use the semantic colors (`--color-primary`, `--color-foreground`, `--color-muted-foreground`, `--color-border`, `--color-surface`, `--color-danger`, …), not raw scales like `--color-blue-600`, which don't change in dark mode. Get the current list from the nuvui MCP `get_tokens` or the vendored `nuvui/tokens.md`. stylelint's `color-no-hex` and `color-named` catch slips.

8. **SCSS variables only for values that must exist at build time.**
   Media query breakpoints (a `var()` can't go in a media query), and maps you loop over. Everything a theme could change is a custom property.
   Why: custom properties cascade, change per `data-theme` and can be set by an ancestor; SCSS variables are frozen into the CSS.

9. **Breakpoints come from nuvui's mixin, smallest screen first.**
   ```scss
   @use "@nuvui/react/scss/mixins" as nuv;

   .invoice-list {
     display: grid;
     gap: calc(var(--spacing) * 2);

     @include nuv.breakpoint("md") {
       grid-template-columns: repeat(2, 1fr);
     }
   }
   ```
   Declarations first, the `breakpoint` include after them. No `max-width` queries. The names are `sm` 40rem, `md` 48rem, `lg` 64rem, `xl` 80rem, `2xl` 96rem. Use `nuv.hover`, `nuv.focus-ring`, `nuv.motion-safe`, `nuv.touch-target` instead of writing those by hand.

10. **Change a nuvui component's look by prop, then `--nuv-*` variable, then token. Never by selector.**
    ```scss
    // Wrong
    .toolbar .nuv-button { border-radius: 9999px !important; }

    // Right
    .toolbar { --nuv-button-radius: var(--radius-full); }
    ```
    Why: nuvui's CSS lives in cascade layers (`tokens`, `base`, `components`); unlayered app CSS already wins, so `!important` and heavier selectors are never needed. Never write a selector for a `nuv-` class, and never name your own class `nuv-*`. stylelint bans `!important`.

11. **Keep the app's CSS unlayered.**
    Why: an unlayered rule beats every layered one, so app styles and token overrides win over nuvui's without tricks. If you must layer app CSS, declare the order once in `globals.scss`: `@layer tokens, base, components, app;`.

12. **Theme by setting tokens, dark mode through `data-theme`.**
    Re-theme by setting nuvui's own token names on `:root` in `src/styles/base/_theme.scss`. Add new tokens only for what nuvui doesn't have, prefixed `--app-` so they can't collide with a future nuvui token. Dark values go inside `@include nuv.dark { … }` at the top level of the file. Never write `@media (prefers-color-scheme: dark)` in a block file; the `<html data-theme="system">` attribute handles it.

13. **Logical properties and 44px touch targets.**
    `margin-inline-start`, `padding-block`, `inline-size`, `inset-inline-end` instead of left/right/width, so right-to-left pages mirror. Interactive elements get `@include nuv.touch-target`.

14. **Animate only inside `nuv.motion-safe`**, with nuvui's duration and easing tokens (`var(--nuv-duration-fast) var(--ease-out)`).

15. **No IDs, no type-qualified classes, no `!important`.**
    `#header`, `div.card` and `!important` all raise specificity in ways BEM exists to avoid. stylelint enforces all three.

## Folder layout

```
apps/<app>/src/
├─ styles/
│  ├─ globals.scss          # imported once in app/layout.tsx, after nuvui's styles.css
│  ├─ abstracts/            # no CSS output: _index.scss forwards nuvui mixins + app functions
│  ├─ base/                 # _theme.scss (token overrides), element defaults for the app frame
│  └─ layout/               # page shell blocks: .app-shell, .page, .site-header
└─ components/<block>/<block>.tsx + <block>.scss
```

Details, the `globals.scss` order and a complete block example: [references/structure.md](references/structure.md).

## Verify

```sh
pnpm exec stylelint "**/*.scss" --allow-empty-input   # or `pnpm lint`, which runs Biome then stylelint
pnpm typecheck
pnpm build                                            # Sass compile errors surface here
```

## Sources

- https://getbem.com/naming/
- https://sass-lang.com/documentation/at-rules/use/
- https://sass-lang.com/documentation/breaking-changes/import/
- https://nextjs.org/docs/app/getting-started/css
- https://nextjs.org/docs/app/guides/sass
- https://stylelint.io/user-guide/rules/selector-class-pattern/
- https://github.com/stylelint-scss/stylelint-config-standard-scss
- https://nuvui.nuvraxis.com/docs/scss (vendored: `nuvui/reference/scss.md`)
- https://nuvui.nuvraxis.com/docs/theming (vendored: `nuvui/rules/styling.md`, `nuvui/tokens.md`)
