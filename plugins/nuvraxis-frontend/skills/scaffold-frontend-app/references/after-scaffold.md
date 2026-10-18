# After the scaffold

Hand these to the user as a checklist; each is a decision or an account action, not something to do silently.

## GitHub

1. Create `github.com/nuvraxis/<name>` and push `main`.
2. Branch protection on `main`: require pull requests, and require the `pr.yaml` checks `quality`, `build`, `docker`, `helm`.
3. Actions → General → Workflow permissions can stay "Read repository contents": each workflow asks for what it needs per job.
4. Tag protection (rulesets) for `v*`: only maintainers can create release tags.

## GHCR

- The first `main.yaml` run creates `ghcr.io/nuvraxis/<name>`; the first release creates `ghcr.io/nuvraxis/charts/<name>`. New packages are **private**.
- Pushing with `GITHUB_TOKEN` links the package to the repo. If a package with the same name already exists unlinked, the push fails: link it in the package settings (Manage Actions access → add the repo with write).
- Public repo and public app? Make both packages public in their settings and drop the pull credentials below.

## Cluster

- An image pull secret named `ghcr-pull` in the app's namespace (a token with `read:packages`), ideally created by External Secrets. `values-production.yaml` already references it.
- The app's runtime secret (`<name>-secrets`) with the keys `src/env.ts` expects.
- An Argo CD repository secret for `ghcr.io/nuvraxis/charts` with `enableOCI: "true"`, and an Application per environment. Examples: the `helm-nextjs` skill, `references/argocd.md`.
- DNS for the production host, and a cert-manager `ClusterIssuer` named as in `values-production.yaml`.

## First release

1. Merge a PR to `main`; wait for `main.yaml` to finish.
2. `git tag v0.1.0 && git push origin v0.1.0`.
3. Check: the GitHub Release has the chart `.tgz`, `image-digest.txt` and `sbom.spdx.json`; `helm show chart oci://ghcr.io/nuvraxis/charts/<name> --version 0.1.0` shows `appVersion: v0.1.0`.
4. Point the production Application's `targetRevision` at `0.1.0`.

## Housekeeping

- Fill in `src/env.ts` with the app's variables, and the chart's `config:` with the non-secret ones.
- Replace the placeholder home page.
- Update `home`/`sources` in `Chart.yaml` if the repo isn't `nuvraxis/<name>`.
