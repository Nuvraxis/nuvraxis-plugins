---
name: helm-nextjs
description: >-
  Helm chart rules for Nuvraxis Next.js apps — one chart per app in charts/ (named after the app), published to oci://ghcr.io/nuvraxis/charts and synced by Argo CD; Chart.yaml version/appVersion set only by release.yaml; Deployment with startup/liveness/readiness probes on /api/health, non-root read-only security context, emptyDir for .next/cache, ConfigMap + existing Secret via envFrom, Service, Ingress with cert-manager, HPA, PDB, ServiceAccount, topology spread; no Helm hooks; helm lint --strict + kubeconform. Use when the repo has charts/, Chart.yaml, values*.yaml, templates/*.yaml with Helm syntax, or an Argo CD Application, or when asked to deploy, scale, expose or configure the app on Kubernetes.
when_to_use: >-
  "deploy to kubernetes", "add an env var to the deployment", "expose it on a domain", "add autoscaling", "the pod keeps restarting", "add a secret", "argo cd", "helm lint fails".
---

# Helm chart for a Next.js app

Use for `charts/<app>/` and how Argo CD consumes it. The image it runs comes from `docker-nextjs`; the pipeline that publishes both is `github-actions`.

The template's `charts/__APP__/` is the source of truth. All values with comments: [references/values.md](references/values.md). Argo CD wiring: [references/argocd.md](references/argocd.md).

## Rules

1. **One chart per app, at `charts/<app>/` in the app's repo root.**
   Why there: Argo CD can sync it straight from git (`path: charts/<app>`) for a dev environment and from the OCI registry for production, with the same files; it's outside `apps/`, so it's neither in the Docker build context nor a pnpm workspace package; and the chart changes in the same PR as the code that needs it. The chart is single-app on purpose: no umbrella, no subcharts. Generic, values-driven templates (like the backend umbrella chart) only where a single app needs the switch: ingress, HPA, PDB, topology spread.

2. **Never hand-edit `version` or `appVersion`.**
   Both stay `0.0.0` in git. `release.yaml` runs `helm package --version X.Y.Z --app-version vX.Y.Z` from the tag `vX.Y.Z`, so the published chart and the image tag always match.

3. **`image.tag` defaults to `appVersion`; set it only for git-synced environments.**
   From OCI, `appVersion` is the release tag and the image is `ghcr.io/nuvraxis/<app>:vX.Y.Z`. Synced from git, `appVersion` is `0.0.0`, so the Argo CD Application sets `image.tag: sha-<short-sha>` (or `main`). `image.repository` is lowercase, always.

4. **Probes: startup, liveness and readiness, all on `/api/health`.**
   The startup probe (2s × 30) covers boot; liveness and readiness only start after it. The route never touches a dependency, so a database outage doesn't restart pods. Don't point a probe at `/`: it renders a page.

5. **Security context matches the image: uid/gid 1001, `runAsNonRoot`, `readOnlyRootFilesystem`, no privilege escalation, all capabilities dropped, `RuntimeDefault` seccomp.** `automountServiceAccountToken: false` on both the ServiceAccount and the pod: the app doesn't call the Kubernetes API.

6. **`.next/cache` is an `emptyDir` with a `sizeLimit`.** It's the only writable path (`/app/apps/<app>/.next/cache`). The limit keeps a runaway image cache from filling the node.

7. **Configuration through `envFrom`: a ConfigMap from `values.config`, and a Secret that already exists.**
   ```yaml
   config:
     API_BASE_URL: https://api.nuvraxis.com
   existingSecret: portal-secrets
   ```
   The chart never templates secret values: no `kind: Secret` with `data` from values, no `--set secret=…`. The Secret is created by External Secrets, Sealed Secrets or an operator, and only its name is in values. A ConfigMap change rolls the pods through the `checksum/config` annotation.

8. **No `NEXT_PUBLIC_*` in the chart.** They're baked in at image build (see `docker-nextjs`); setting them at runtime does nothing.

9. **Resources: requests for CPU and memory, a memory limit, no CPU limit.** CPU limits throttle a Node server during bursts and inflate tail latency; the memory limit stays because Node's heap grows to what it's given.

10. **High availability by default: 2 replicas, PDB `maxUnavailable: 1`, rolling update with `maxUnavailable: 0`, topology spread across zones and nodes (`ScheduleAnyway`).** With `autoscaling.enabled` the Deployment omits `replicas`, so Argo CD and the HPA don't fight over it.

11. **Ingress is opt-in, TLS through cert-manager annotations.** `ingress.enabled`, `className`, hosts, `tls` with a `secretName`, and `cert-manager.io/cluster-issuer` in annotations. For streaming responses on ingress-nginx add `nginx.ingress.kubernetes.io/proxy-buffering: "off"`; for rate limiting, `limit-rps` (see `nextjs-security`).

12. **No Helm hooks, no `lookup`, no random values.** Argo CD renders the chart with `helm template` and applies the result: hooks become Argo hooks with different semantics, `lookup` returns nothing, and `randAlphaNum` changes on every sync and shows the app permanently out of sync. Everything rendered must be a pure function of the values.

13. **Private GHCR packages need pull credentials.** GHCR packages are private on first push. For images: a `docker-registry` Secret with a token that has `read:packages`, referenced in `imagePullSecrets` (production values reference `ghcr-pull`). For the chart in Argo CD: a repository Secret with `enableOCI: "true"` (see `references/argocd.md`). Or make the packages public in GitHub if the code is public.

14. **`values-production.yaml` holds only what differs in production.** Layer it: `-f values.yaml -f values-production.yaml`. Don't copy the defaults into it.

15. **Validate with `helm lint --strict` and `helm template | kubeconform -strict`.**
    Why kubeconform over helm-unittest: the bugs a single-app chart actually has are wrong field names, types or API versions in the rendered output, which kubeconform catches against the real Kubernetes schemas with zero test code. helm-unittest asserts template logic, which this chart barely has. Lint and validate both values files, as `pr.yaml` does.

## Adding things

| Need | Change |
|---|---|
| A runtime env var | `config:` in values (non-secret) or a key in the existing Secret |
| A secret | add it to the external Secret; nothing in the chart changes |
| Another port or sidecar | justify it first; a Next app needs one port |
| A cron job | a separate chart or app, not this Deployment |
| NetworkPolicy | add `templates/networkpolicy.yaml`, toggled by `networkPolicy.enabled` |

## Verify

```sh
helm lint --strict charts/<app>
helm lint --strict charts/<app> -f charts/<app>/values-production.yaml
helm template <app> charts/<app> -f charts/<app>/values-production.yaml \
  | docker run --rm -i ghcr.io/yannh/kubeconform:v0.8.0 -strict -summary -kubernetes-version 1.34.0 -
```

## Sources

- https://helm.sh/docs/topics/charts/
- https://helm.sh/docs/chart_best_practices/
- https://helm.sh/docs/topics/registries/
- https://helm.sh/docs/overview/
- https://github.com/yannh/kubeconform
- https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- https://kubernetes.io/docs/concepts/security/pod-security-standards/
- https://kubernetes.io/docs/concepts/scheduling-eviction/topology-spread-constraints/
- https://kubernetes.io/docs/concepts/workloads/pods/disruptions/
- https://argo-cd.readthedocs.io/en/stable/user-guide/helm/
- https://cert-manager.io/docs/usage/ingress/
- https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry
