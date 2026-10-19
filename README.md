# nuvraxis-plugins

Claude Code plugins from Nuvraxis. One plugin so far, **`nuvraxis-frontend`**: our production conventions for Next.js apps (TypeScript 7, Next.js 16 App Router, nuvui, Biome, SCSS + BEM, pnpm 12 + Turborepo) and the path every app takes to production: Docker → GHCR → Helm → Argo CD, driven by GitHub Actions.

## Install

In Claude Code:

```
/plugin marketplace add Nuvraxis/nuvraxis-plugins
/plugin install nuvraxis-frontend@nuvraxis-plugins
```

To share it with everyone working in a repo, install it at project scope from that repo (this writes `.claude/settings.json`, which you commit):

```sh
claude plugin install nuvraxis-frontend@nuvraxis-plugins --scope project
```

Then start a new app:

```
/nuvraxis-frontend:scaffold-frontend-app my-app
```

## What's inside

### Skills

Claude loads a skill when the task matches its description (a `Dockerfile`, a `.scss` file, a `"use server"` action…). You can also call one directly as `/nuvraxis-frontend:<name>`.

| Skill | Covers |
|---|---|
| `typescript-production` | TS 7 strict config layering, unions, branded ids, valibot at the edges, exports maps, type tests |
| `nextjs-production` | Server/Client boundaries, Cache Components (`use cache`), Server Actions, env, health route, standalone output |
| `nextjs-security` | Auth in every action and handler, cookies, nonce CSP (with nuvui's needs), headers, redirects, SSRF |
| `biome` | One root config, presets and domains, nested configs, `biome ci`, migrating off ESLint/Prettier |
| `scss-bem` | BEM naming, one block per file, nuvui tokens and mixins, stylelint rules |
| `pnpm-turborepo` | `pnpm-workspace.yaml` catalog and supply-chain settings, workspace layout, `turbo.json`, `--affected` |
| `docker-nextjs` | Five-stage Dockerfile, pinned Node 26 Alpine, verified pnpm, non-root, read-only root filesystem |
| `helm-nextjs` | One chart per app, probes, security context, ConfigMap + existing Secret, HPA/PDB, Argo CD |
| `github-actions` | `pr.yaml`, `main.yaml`, `release.yaml`, permissions, pins, the release ritual |
| `scaffold-frontend-app` | **User-invoked only.** Creates a new repo from the templates and proves it builds |
| `nuvui` | Vendored from [Nuvraxis/nuvui](https://github.com/Nuvraxis/nuvui): the component library's own skill |
| `turborepo` | Vendored from [vercel/turborepo](https://github.com/vercel/turborepo): points Claude at the docs bundled in `turbo` |

### MCP server

`nuvui` (`https://nuvui.nuvraxis.com/mcp`, no auth): rules, component pages, blocks, tokens. Check it's connected with `/mcp`. Generated apps also get `next-devtools-mcp` in their own `.mcp.json`.

### Hook

After Claude edits or writes a file, `biome check --write` runs on it, but only when a `biome.json` sits above the file and Biome is installed. Anywhere else it does nothing.

### Templates

`plugins/nuvraxis-frontend/templates/` is the file tree the scaffold copies, with `__APP__` as the app name. It's the source of truth: the skills explain these files, and CI fails if a file embedded in a skill drifts from its template.

## The delivery pipeline of a generated app

```
 pull request ──► pr.yaml       Biome · stylelint · typecheck · test · build (turbo --affected)
                                docker build + run read-only + /api/health · helm lint + kubeconform
                                nothing is published

 merge to main ─► main.yaml     one multi-arch image, provenance + SBOM
                                → ghcr.io/nuvraxis/<app>:sha-<short>  and  :main

 tag vX.Y.Z ────► release.yaml  tag must be on main; no rebuild:
                                sha-<short> retagged → :vX.Y.Z and :latest
                                chart X.Y.Z → oci://ghcr.io/nuvraxis/charts/<app>
                                GitHub Release with the chart, image digest and SBOM

 Argo CD ───────► syncs the chart from OCI (production) or charts/<app> in git (dev)
```

Release ritual: merge to main, wait for `main.yaml` to go green, then `git tag vX.Y.Z && git push origin vX.Y.Z`.

## Working on this repo

Requirements: Node 24+, pnpm (any 11+; it switches to the pinned version), git, and for the template checks Docker and Helm.

```sh
pnpm validate   # claude plugin validate --strict, plugin + marketplace
pnpm check      # own skills meet the standard; embedded templates match templates/
pnpm sync       # re-vendor nuvui and turborepo skills at upstream HEAD, rewrite UPSTREAM.json
pnpm sync --check   # fail if the vendored copies differ from the pinned commits (CI runs this)
```

`.github/workflows/validate.yml` runs all of the above, then scaffolds a throwaway app from the templates and runs install, typecheck, lint, build, actionlint, `helm lint --strict`, kubeconform, `docker build`, and a read-only container health check.

### Vendored skills

`skills/nuvui` and `skills/turborepo` are copies, pinned in `UPSTREAM.json`. Don't edit them: run `pnpm sync`, review the diff, commit. Project-specific guidance goes in our own skills.

### Skill standard

Each own skill has a `SKILL.md` of at most 300 lines (frontmatter `name` + a `description` that names the files and dependencies that should trigger it), numbered rules with a reason and a wrong/right pair where it isn't obvious, a `## Verify` block with the exact `pnpm` commands, `## Sources`, longer material in `references/`, and three tasks in `evals/evals.json` in the same shape as nuvui's evals. `pnpm check` enforces the mechanical parts.

### Releasing the plugin

Users stay on the version they installed until `version` in `plugins/nuvraxis-frontend/.claude-plugin/plugin.json` changes. To release:

1. Bump `version` (semver: a new skill or template change is minor; a rule fix is patch; a change that breaks generated repos is major).
2. Merge to `main`.
3. `git tag vX.Y.Z && git push origin vX.Y.Z`.

Users update with `/plugin marketplace update nuvraxis-plugins`.

## Privacy

The plugins collect no data and contain no telemetry. Details, including what the nuvui MCP server receives: [PRIVACY.md](PRIVACY.md).

## License

MIT. The vendored skills keep their upstream licenses.
