# Action pins

Checked 2026-10-18.

| Action | Major used | Latest release | Commit SHA of that release |
|---|---|---|---|
| `actions/checkout` | v7 | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | v7 | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| `pnpm/action-setup` | v6 | v6.1.0 | `ea17c68df8912ef543352723c149a84f56e3d413` |
| `docker/setup-qemu-action` | v4 | v4.4.0 | `99012661954931238ded8c8b007157a8430204e1` |
| `docker/setup-buildx-action` | v4 | v4.4.1 | `f87e5991a6d7451dcb8d9637bfbc97413f497069` |
| `docker/login-action` | v4 | v4.6.0 | `dbcb813823bdd20940b903addbd779551569679f` |
| `docker/metadata-action` | v6 | v6.2.0 | `dc802804100637a589fabce1cb79ff13a1411302` |
| `docker/build-push-action` | v7 | v7.4.0 | `c3c9e263c25d99ce0380d002d59b67737d91b0dc` |
| `azure/setup-helm` | v5 | v5.0.1 | `9bc31f4ebc9c6b171d7bfbaa5d006ae7abdb4310` |

`pnpm/action-setup`'s floating `v6` tag lagged behind `v6.1.0` when checked (it pointed at v6.0.10). If you pin by SHA, use the v6.1.0 SHA above. pnpm also publishes a successor action, `pnpm/setup`, that can install Node and pnpm together; the template stays on action-setup + setup-node until that's been tried in a real repo.

Tools run inside workflows are pinned in `env:` at the top of each file: Helm `v4.3.1`, kubeconform image `ghcr.io/yannh/kubeconform:v0.8.0`, Kubernetes schema version `1.34.0`.

## Why majors in the template, and when to switch to SHAs

A major tag is readable and picks up fixes automatically, and these are first-party or widely used publisher actions. A tag can be moved by whoever controls the action's repository, though; a SHA can't. Switch to SHAs when:

- the org enforces "actions must be pinned to a full-length commit SHA" (GitHub's policy setting), or
- the repo handles anything you'd treat as production-critical secrets beyond `GITHUB_TOKEN`.

Format:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

## Refreshing this table

```sh
for repo in actions/checkout actions/setup-node pnpm/action-setup docker/setup-qemu-action \
            docker/setup-buildx-action docker/login-action docker/metadata-action \
            docker/build-push-action azure/setup-helm; do
  tag=$(gh release view --repo "$repo" --json tagName -q .tagName)
  sha=$(gh api "repos/$repo/commits/$tag" -q .sha)
  echo "$repo $tag $sha"
done
```

`pnpm outdated -r` also reports outdated GitHub Actions in the repo's workflows.
