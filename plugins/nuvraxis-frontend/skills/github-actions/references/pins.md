# Action pins

Every `uses:` in the template workflows (and in the plugin repo's own `validate.yml`) is pinned to a full commit SHA, with the release it came from as a trailing comment. Dependabot (`.github/dependabot.yml`, `github-actions` ecosystem, weekly, one grouped PR) bumps the SHA and the comment together.

Pins in use, resolved **2026-10-18**:

| Action | Release | Commit SHA |
|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| `pnpm/action-setup` | v6.1.0 | `ea17c68df8912ef543352723c149a84f56e3d413` |
| `docker/setup-qemu-action` | v4.4.0 | `99012661954931238ded8c8b007157a8430204e1` |
| `docker/setup-buildx-action` | v4.4.1 | `f87e5991a6d7451dcb8d9637bfbc97413f497069` |
| `docker/login-action` | v4.6.0 | `dbcb813823bdd20940b903addbd779551569679f` |
| `docker/metadata-action` | v6.2.0 | `dc802804100637a589fabce1cb79ff13a1411302` |
| `docker/build-push-action` | v7.4.0 | `c3c9e263c25d99ce0380d002d59b67737d91b0dc` |
| `azure/setup-helm` | v5.0.1 | `9bc31f4ebc9c6b171d7bfbaa5d006ae7abdb4310` |

Format:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

Tools run inside workflows are pinned in `env:` at the top of each file: Helm `v4.3.1`, kubeconform image `ghcr.io/yannh/kubeconform:v0.8.0`, Kubernetes schema version `1.34.0`.

## Why SHAs

A tag can be moved by whoever controls the action's repository; a commit SHA can't. `main.yaml` and `release.yaml` run third-party actions in jobs with `packages: write` (and `contents: write` for the release), holding the `GITHUB_TOKEN`. A moved tag there could push images or charts to GHCR. The cost of SHAs, staleness, is what Dependabot removes.

## Adding an action

1. Resolve its latest release and commit (below).
2. Pin it in the workflow with the `# vX.Y.Z` comment.
3. Add a row here.

Never add `@main`, `@master` or a bare major tag.

## Resolving SHAs by hand

```sh
for repo in actions/checkout actions/setup-node pnpm/action-setup docker/setup-qemu-action \
            docker/setup-buildx-action docker/login-action docker/metadata-action \
            docker/build-push-action azure/setup-helm; do
  tag=$(gh release view --repo "$repo" --json tagName -q .tagName)
  sha=$(gh api "repos/$repo/commits/$tag" -q .sha)
  echo "$repo $tag $sha"
done
```

`gh api repos/<repo>/commits/<tag>` returns the commit even for annotated tags; don't use the tag object's own SHA.

pnpm also publishes `pnpm/setup`, a successor to `pnpm/action-setup` that can install Node and pnpm together; the templates stay on action-setup + setup-node until that's been tried in a real repo.
