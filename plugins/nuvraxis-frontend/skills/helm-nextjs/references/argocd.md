# Argo CD

## Production: the released chart from GHCR

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: portal
  namespace: argocd
spec:
  project: default
  source:
    repoURL: ghcr.io/nuvraxis/charts     # no oci:// prefix for Helm OCI sources
    chart: portal
    targetRevision: 1.4.0                # chart version = release tag without the v
    helm:
      valueFiles:
        - values.yaml
        - values-production.yaml
  destination:
    server: https://kubernetes.default.svc
    namespace: portal
  syncPolicy:
    automated: { prune: true, selfHeal: true }
    syncOptions: [CreateNamespace=true]
```

Promotion is a change to `targetRevision`, in the GitOps repo that holds the Applications. The image follows, because the chart's `appVersion` is the tag.

### Credentials for a private chart

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: ghcr-nuvraxis-charts
  namespace: argocd
  labels:
    argocd.argoproj.io/secret-type: repository
stringData:
  type: helm
  name: ghcr-nuvraxis-charts
  url: ghcr.io/nuvraxis/charts
  enableOCI: "true"
  username: <github-user-or-bot>
  password: <token with read:packages>
```

Create it with your secrets tooling, not by committing this file with a real token.

## Dev / preview: the chart from git, the image from main

```yaml
spec:
  source:
    repoURL: https://github.com/nuvraxis/portal.git
    path: charts/portal
    targetRevision: main
    helm:
      valueFiles: [values.yaml]
      parameters:
        - name: image.tag
          value: main          # or sha-<short-sha> to pin one commit
```

`appVersion` is `0.0.0` in git, so `image.tag` must be set here. `main` moves with every merge; pair it with `image.pullPolicy: Always` or a restart if you want new pods on each build, or use an image updater to write `sha-…` tags.

## Image pull secret in the app namespace

```sh
kubectl -n portal create secret docker-registry ghcr-pull \
  --docker-server=ghcr.io --docker-username=<user> --docker-password=<token with read:packages>
```

Better: let External Secrets create it from your vault, and reference `ghcr-pull` in `imagePullSecrets`.

## What keeps the chart Argo-friendly

- Output depends only on values: no hooks, `lookup`, `randAlphaNum`, `now`.
- `replicas` omitted when the HPA is on.
- Labels on the selector never change between versions.
- The ConfigMap checksum annotation is deterministic, so it only changes when config does.
