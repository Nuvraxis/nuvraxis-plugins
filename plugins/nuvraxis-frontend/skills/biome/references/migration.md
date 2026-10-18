# Migrating from ESLint and Prettier

1. **Install Biome and start from the template config.**
   ```sh
   pnpm add -D -w @biomejs/biome@catalog:
   ```
   Copy the template's `biome.json` to the root.

2. **Carry over settings worth keeping.**
   ```sh
   pnpm exec biome migrate prettier --write   # reads .prettierrc / package.json "prettier"
   pnpm exec biome migrate eslint --write     # reads eslint.config.* or .eslintrc*
   ```
   Review the diff to `biome.json`. Keep rules that encode a real team decision; drop the ones that only restate `recommended`. Don't use `--include-nursery`. `--include-inspired` brings in rules that only resemble the ESLint ones; check each.

3. **Format everything in one commit.**
   ```sh
   pnpm exec biome check --write .
   ```
   Commit it alone ("chore: format with Biome") and add the commit to `.git-blame-ignore-revs`, so blame skips it.

4. **Fix what's left.** `pnpm exec biome check .` lists the remaining lint errors. Fix them; suppress a single line only with a reason.

5. **Remove the old tools.**
   ```sh
   pnpm remove -r eslint prettier eslint-config-next @typescript-eslint/parser @typescript-eslint/eslint-plugin eslint-plugin-react eslint-plugin-react-hooks eslint-config-prettier
   ```
   Delete `.eslintrc*`, `eslint.config.*`, `.eslintignore`, `.prettierrc*`, `.prettierignore`, and any `lint`/`format` scripts that call them. Replace them with the template's root scripts (`lint`, `lint:fix`, `format`).

6. **Editor and CI.** Switch `.vscode/settings.json` to the template's. In CI replace `eslint`/`prettier --check` steps with `pnpm exec biome ci --reporter=github .`.

7. **SCSS.** If Prettier was formatting `.scss`, that stops: add stylelint per `scss-bem` and run `pnpm exec stylelint "**/*.scss" --fix` once.

Rules with no Biome equivalent: note them in the PR. Usually they were style preferences; if one guarded a real bug class, look for a Biome rule under a different name (`pnpm exec biome explain <rule>`) before giving up on it.
