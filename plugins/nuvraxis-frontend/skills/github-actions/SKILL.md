---
name: github-actions
description: >-
  GitHub Actions conventions for Nuvraxis Next.js apps — exactly three workflows: pr.yaml (every PR to any branch: Biome, stylelint, typecheck/test/build with turbo --affected, Docker build + health check, helm lint + kubeconform; publishes nothing), main.yaml (push to main: one multi-arch image to GHCR tagged sha-SHORTSHA and main, provenance + SBOM, gha cache), release.yaml (tag vX.Y.Z: verify on main, retag the existing image without rebuilding, package and push the Helm chart to OCI, GitHub Release with chart, digest and SBOM). Minimal permissions per job, GITHUB_TOKEN only, pinned action majors. Use when editing .github/workflows/*, adding a CI step, or debugging a failed run or release.
when_to_use: >-
  "add a CI check", "the release failed", "image not found for this commit", "set up CI/CD", "publish the chart", "why did CI run on draft", "speed up CI", "pin actions".
---

# GitHub Actions

Three workflows per app, each with one job of its kind. The template's `.github/workflows/{pr,main,release}.yaml` are the source of truth; they're reproduced with notes in [references/workflows.md](references/workflows.md).

```
pull request ──► pr.yaml       checks only, nothing published
merge to main ─► main.yaml     image built once → ghcr.io/nuvraxis/<app>:sha-<short>, :main
tag vX.Y.Z ────► release.yaml  same image retagged :vX.Y.Z, :latest · chart X.Y.Z → OCI · GitHub Release
```

## Rules for every workflow

1. **`permissions: contents: read` at the top; widen per job only as needed.** `packages: write` for jobs that push to GHCR, `contents: write` only for the job that creates the Release. No `id-token: write` or `attestations: write`: provenance and SBOM come from BuildKit, not `actions/attest*` (which needs GitHub Enterprise for private repos).

2. **`GITHUB_TOKEN` only.** GHCR login uses `${{ github.actor }}` / `${{ secrets.GITHUB_TOKEN }}`; `gh` uses `GH_TOKEN: ${{ github.token }}`. No personal access tokens in CI. (Pulling private packages from the cluster is a different credential; see `helm-nextjs`.)

3. **Pin action majors (`@v7`) and keep the SHA table current.** The template uses major tags for readability. If the org requires SHA pinning, replace each `@vN` with the SHA from [references/action-pins.md](references/action-pins.md) and keep the `# vN.M.P` comment. Current majors: checkout v7, setup-node v7, pnpm/action-setup v6, setup-qemu v4, setup-buildx v4, login v4, metadata v6, build-push v7, azure/setup-helm v5.

4. **Toolchain: `pnpm/action-setup` before `actions/setup-node`.** action-setup reads the pnpm version from `packageManager`; setup-node reads `.node-version` and caches the pnpm store (`cache: pnpm` needs pnpm on PATH first). Then `pnpm install --frozen-lockfile`. Never `npm ci`.

5. **`concurrency` per workflow and ref; cancel in progress on PRs only.** A new push to a PR cancels the old run. On main and tags runs always finish: release.yaml needs the image of that exact commit.

6. **Never echo secrets or interpolate untrusted input into `run:`.** Pass values through `env:` and quote them (`"${APP}"`). `${{ github.event.pull_request.title }}` and similar never go inside a script. `persist-credentials: false` on checkout when the job doesn't push to git.

7. **Every job has `timeout-minutes`.** A hung Docker build otherwise burns six hours.

8. **Names are lowercase.** GHCR rejects uppercase repositories. `IMAGE: ghcr.io/nuvraxis/<app>` is written lowercase in `env`; the scaffold lowercases the app name.

## pr.yaml

9. **`on: pull_request` with `types: [opened, synchronize, reopened, ready_for_review]` and no `branches` filter**, so stacked PRs against feature branches are checked too. Every job has `if: ${{ !github.event.pull_request.draft }}`; marking ready triggers the run.

10. **Four parallel jobs:** `quality` (`biome ci --reporter=github`, stylelint, `turbo run typecheck test --affected`, `pnpm audit --audit-level high`), `build` (`turbo run build --affected`), `docker` (build one platform with `load: true`, run it read-only with capabilities dropped, curl `/api/health`), `helm` (`helm lint --strict` and kubeconform on both values files). `--affected` needs `fetch-depth: 0`.

11. **Nothing is pushed from a PR.** `push: false`, cache read-only (`cache-from` only), no registry login.

## main.yaml

12. **`on: push: branches: [main]` builds the image once, for both architectures, and pushes it.** Tags from `docker/metadata-action`: `type=sha,format=short,prefix=sha-` and `type=raw,value=main`, `flavor: latest=false`. `latest` belongs to releases.

13. **`provenance: mode=max`, `sbom: true`, `cache-from/to: type=gha,scope=<app>,mode=max`.** Provenance and SBOM are attached to the image index; release.yaml carries them along when it retags. `NEXT_DEPLOYMENT_ID=${{ github.sha }}` is the build arg for skew protection.

14. **main.yaml doesn't publish the chart and doesn't re-run PR checks.** Branch protection requires pr.yaml; main only produces the artefact.

## release.yaml

15. **`on: push: tags: ['v*.*.*']`, then in order:**
    1. Fail unless the tag is exactly `vMAJOR.MINOR.PATCH` and its commit is an ancestor of `origin/main`.
    2. **Don't rebuild.** If `ghcr.io/nuvraxis/<app>:sha-<short>` doesn't exist, fail with "let main.yaml finish, then re-run". No fallback build.
    3. `docker buildx imagetools create --tag :vX.Y.Z --tag :latest <sha-image>`: a manifest-level copy that keeps both architectures, provenance and SBOM, at the same digest.
    4. `helm package --version X.Y.Z --app-version vX.Y.Z`, `helm push` to `oci://ghcr.io/nuvraxis/charts`.
    5. `gh release create vX.Y.Z --verify-tag --generate-notes` with the chart `.tgz`, `image-digest.txt` and `sbom.spdx.json` attached.

16. **The release ritual:** merge to main → wait for main.yaml to go green → `git tag vX.Y.Z && git push origin vX.Y.Z`. Tagging before main.yaml finishes fails step 2 on purpose; re-run the release job once the image exists. A bad release is fixed with a new patch tag, never by moving a tag.

## Speeding things up (only when needed)

- arm64 under QEMU is the slow part of main.yaml. Replace with a matrix on `ubuntu-24.04-arm` + `ubuntu-latest` pushing by digest, then a merge job with `imagetools create`. Keep the tags and the single index.
- Turborepo remote cache for pr.yaml: see `pnpm-turborepo`.

## Verify

```sh
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest     # lint all workflows
gh workflow list && gh run list --limit 5
gh run view <run-id> --log-failed
```

After a release: `docker buildx imagetools inspect ghcr.io/nuvraxis/<app>:vX.Y.Z` shows both platforms, and `helm show chart oci://ghcr.io/nuvraxis/charts/<app> --version X.Y.Z` shows `appVersion: vX.Y.Z`.

## Sources

- https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions
- https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions
- https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/controlling-permissions-for-github_token
- https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
- https://github.com/pnpm/action-setup
- https://github.com/actions/setup-node
- https://github.com/docker/metadata-action
- https://github.com/docker/build-push-action
- https://docs.docker.com/build/ci/github-actions/cache/#github-cache
- https://docs.docker.com/build/metadata/attestations/
- https://docs.docker.com/reference/cli/docker/buildx/imagetools/create/
- https://helm.sh/docs/topics/registries/
- https://cli.github.com/manual/gh_release_create
- https://turborepo.dev/docs/reference/run#--affected
