# SCSS structure in an app

## Load order

`app/layout.tsx` imports the stylesheets once, nuvui first:

```tsx
import "@nuvui/react/styles.css";
// import "@nuvui/table/styles.css";   // each add-on that's used, after the core
import "@/styles/globals.scss";
```

`src/styles/globals.scss`:

<!-- template: apps/__APP__/src/styles/globals.scss -->
```scss
// Imported once, by src/app/layout.tsx, after @nuvui/react/styles.css.
// Unlayered on purpose: these rules beat nuvui's `tokens`, `base` and `components` layers.
// Component blocks aren't listed here; each component imports its own file.
@use "base/theme";
@use "base/elements";
@use "layout/page";
```

## `abstracts/`

Produces no CSS. Anything `@use`d from a block file must live here, so a block can pull it in many times without duplicating output.

<!-- template: apps/__APP__/src/styles/abstracts/_index.scss -->
```scss
// No CSS output. Block files `@use "abstracts" as a;` (resolved through sassOptions.loadPaths).
@forward "@nuvui/react/scss/mixins";
@forward "functions";
```

<!-- template: apps/__APP__/src/styles/abstracts/_functions.scss -->
```scss
/// Space on nuvui's spacing scale: space(4) → calc(var(--spacing) * 4).
@function space($steps) {
  @return calc(var(--spacing) * #{$steps});
}
```

With `sassOptions.loadPaths: ["src/styles"]` in `next.config.ts`, a block writes `@use "abstracts" as a;` from any depth. Without it, use a relative path; don't use `~` or webpack aliases, Turbopack doesn't resolve them in Sass.

## `base/_theme.scss`

```scss
@use "abstracts" as a;

:root {
  // nuvui's own token names re-themed for this app.
  --color-primary: var(--color-green-700);
  --radius-md: 0.5rem;

  // Tokens nuvui doesn't have: prefixed so they can't collide with a future nuvui token.
  --app-sidebar-width: 16rem;
}

// Writes the declarations for [data-theme="dark"], and again for [data-theme="system"]
// when the system is dark. Top level of the file only: the mixin supplies the selectors.
@include a.dark {
  --color-primary: var(--color-green-400);
}
```

Set the dark value next to every semantic color you change: a value set on `:root` alone replaces both the light and the dark one. This file is the only place dark values live.

## A complete block

```tsx
// src/components/invoice-card/invoice-card.tsx
import "./invoice-card.scss";
import { Badge } from "@nuvui/react";

type Props = { number: string; total: string; overdue: boolean };

export function InvoiceCard({ number, total, overdue }: Props) {
  return (
    <article className={overdue ? "invoice-card invoice-card--overdue" : "invoice-card"}>
      <h3 className="invoice-card__title">{number}</h3>
      <p className="invoice-card__total">{total}</p>
      {overdue && <Badge intent="danger" className="invoice-card__badge">Overdue</Badge>}
    </article>
  );
}
```

```scss
// src/components/invoice-card/invoice-card.scss
@use "abstracts" as a;

.invoice-card {
  display: grid;
  gap: a.space(2);
  padding: a.space(4);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background-color: var(--color-surface);
  color: var(--color-surface-foreground);

  @include a.breakpoint("md") {
    grid-template-columns: 1fr auto;
    align-items: center;
  }

  &__title {
    font-size: var(--text-lg);
    font-weight: var(--font-weight-semibold);
  }

  &__total {
    font-variant-numeric: tabular-nums;
    color: var(--color-muted-foreground);
  }

  &__badge {
    justify-self: start;
  }

  &--overdue {
    border-color: var(--color-danger);
  }
}

// A block modifier styling an element: the one descendant selector BEM allows.
.invoice-card--overdue .invoice-card__total {
  color: var(--color-danger);
}
```

`className` on the nuvui `Badge` places it (`justify-self`); its look comes from `intent`.

## Naming a block

- Name it after what it is in the product, not what it looks like: `invoice-card`, not `grey-box`.
- Two words or more for anything app-specific, so it never shadows a generic name a package might use.
- A page-level wrapper is a layout block (`.page`, `.page__header`) in `styles/layout/`, not repeated per route.
- When an element grows its own elements, promote it to a block with its own file.

## Migrating CSS Modules to this convention

1. Rename `foo.module.scss` → `foo.scss` and give the root class the block name.
2. Rename each class to `block__element` / `block--modifier`.
3. Replace `styles.x` with the literal class string, and `import styles from` with a bare `import "./foo.scss"`.
4. Remove `:global(...)` wrappers; global is now the default.
5. Run stylelint; fix what the BEM pattern flags.
