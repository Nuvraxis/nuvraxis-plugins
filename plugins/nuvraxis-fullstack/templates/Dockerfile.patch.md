# Dockerfile patch

The fullstack scaffold makes exactly one change to the frontend's `apps/__APP__/Dockerfile`: two `COPY` lines in the `runner` stage, right after the line that copies `public`. Everything else in the image stays identical.

Insert after this line:

```dockerfile
COPY --from=builder /repo/apps/__APP__/public ./apps/__APP__/public
```

these lines:

<!-- template: Dockerfile.migrate.snippet -->
```dockerfile
# nuvraxis-fullstack: the migrate Job's runner (one bundled file) and the SQL migrations it applies.
COPY --from=builder /repo/packages/db/dist/migrate.mjs ./packages/db/dist/migrate.mjs
COPY --from=builder /repo/packages/db/drizzle ./packages/db/drizzle
```

Why nothing else changes:

- `turbo prune __APP__ --docker` already includes `packages/db`, because the app depends on `@__SCOPE__/db`.
- The `builder` stage's `turbo run build --filter=__APP__` builds `^build` dependencies first, so `packages/db`'s `build` task (esbuild) writes `dist/migrate.mjs` before Next builds.
- `dist/migrate.mjs` bundles `drizzle-orm` and `pg`, so it needs no `node_modules`. The Next.js standalone output doesn't contain drizzle-orm's migrator (Turbopack bundles drizzle-orm into the app), which is why the runner can't just import it.
- The migrator resolves `../drizzle` from its own location, so the two paths above must stay side by side: `packages/db/dist/` and `packages/db/drizzle/`.
- Both files stay root-owned and read-only, like the rest of the image. The Job writes nothing to disk.

The Job then runs `node packages/db/dist/migrate.mjs` from `/app`, with the same image tag as the Deployment.
