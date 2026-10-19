# Migrations in Kubernetes with Argo CD

## How a migration reaches production

1. PR adds `packages/db/drizzle/<ts>_<name>/` with the schema change; `pr.yaml`'s `db` job checks it and runs it twice against Postgres 17.
2. Merge → `main.yaml` builds the image once; it contains `packages/db/dist/migrate.mjs` and `packages/db/drizzle/`.
3. Tag `vX.Y.Z` → `release.yaml` retags that image and publishes chart `X.Y.Z` (no change for the database).
4. Argo CD syncs chart `X.Y.Z`: the PreSync Job runs `node packages/db/dist/migrate.mjs` from image `vX.Y.Z`. Only if it exits 0 does Argo apply the new Deployment; otherwise the sync fails and the old pods keep running against the unchanged schema.
5. The rolling update replaces pods; old and new pods overlap, which is why every migration must work with the previous app version.

## The Job (chart overlay template)

<!-- template: charts-overlay/templates/migrate-job.yaml -->
```yaml
{{- if .Values.db.migrate.enabled }}
# Runs the app's committed migrations before Argo CD applies the new Deployment.
# Same image and tag as the Deployment; no drizzle-kit in the image, only the bundled runner.
apiVersion: batch/v1
kind: Job
metadata:
  # A fixed name: with BeforeHookCreation, the next sync deletes this Job and creates it again.
  name: {{ include "app.fullname" . }}-migrate
  labels:
    {{- include "app.labels" . | nindent 4 }}
    app.kubernetes.io/component: migrate
  annotations:
    argocd.argoproj.io/hook: PreSync
    argocd.argoproj.io/hook-delete-policy: BeforeHookCreation
spec:
  # Drizzle takes no migration lock: exactly one runner, tried at most twice, ten minutes max.
  parallelism: 1
  completions: 1
  backoffLimit: 1
  activeDeadlineSeconds: 600
  template:
    metadata:
      labels:
        # Not the app's selector labels: the Service and PDB must never select this pod.
        app.kubernetes.io/name: {{ include "app.name" . }}-migrate
        app.kubernetes.io/instance: {{ .Release.Name }}
        app.kubernetes.io/component: migrate
    spec:
      restartPolicy: Never
      {{- with .Values.imagePullSecrets }}
      imagePullSecrets:
        {{- toYaml . | nindent 8 }}
      {{- end }}
      serviceAccountName: {{ include "app.serviceAccountName" . }}
      automountServiceAccountToken: false
      securityContext:
        {{- toYaml .Values.podSecurityContext | nindent 8 }}
      containers:
        - name: migrate
          image: {{ include "app.image" . | quote }}
          imagePullPolicy: {{ .Values.image.pullPolicy }}
          command:
            {{- toYaml .Values.db.migrate.command | nindent 12 }}
          securityContext:
            {{- toYaml .Values.securityContext | nindent 12 }}
          envFrom:
            - secretRef:
                name: {{ include "app.dbSecretName" . }}
          resources:
            {{- toYaml .Values.db.migrate.resources | nindent 12 }}
{{- end }}
```

<!-- template: charts-overlay/templates/_db-helpers.tpl -->
```yaml
{{/* The existing Secret that holds DATABASE_URL: db.externalSecret.name, or <fullname>-db. */}}
{{- define "app.dbSecretName" -}}
{{- default (printf "%s-db" (include "app.fullname" .)) .Values.db.externalSecret.name }}
{{- end }}
```

## Values merged under `db:`

<!-- template: charts-overlay/values.db.yaml -->
```yaml
# Merged into values.yaml under `db:` by the fullstack scaffold. Frontend values are untouched.

# An existing Secret with a DATABASE_URL key, created outside the chart (External Secrets,
# Sealed Secrets, or by hand). Empty means "<release fullname>-db". The chart only references
# it: the Deployment and the migrate Job load it with envFrom. It must exist before the first
# sync, or the migrate pod stays in CreateContainerConfigError and the sync never starts.
externalSecret:
  name: ""

migrate:
  # Run committed migrations as an Argo CD PreSync Job on every sync.
  enabled: true
  # The bundled runner in the app image (see Dockerfile.patch.md). It exits non-zero on failure,
  # which fails the sync before the new Deployment is applied.
  command: ["node", "packages/db/dist/migrate.mjs"]
  resources:
    requests:
      cpu: 50m
      memory: 128Mi
    limits:
      memory: 256Mi
```

## The Deployment's extra envFrom

Inserted after the frontend chart's `existingSecret` block, so the app also gets `DATABASE_URL` (skipped when both names are the same Secret):

<!-- template: charts-overlay/deployment-envfrom.yaml -->
```yaml
            {{- if ne (include "app.dbSecretName" .) .Values.existingSecret }}
            - secretRef:
                name: {{ include "app.dbSecretName" . }}
            {{- end }}
```

## Notes appended to NOTES.txt

<!-- template: charts-overlay/NOTES.db.txt -->
```text

Database: migrations run as the PreSync Job {{ include "app.fullname" . }}-migrate before each sync.
  The Secret "{{ include "app.dbSecretName" . }}" with DATABASE_URL must exist before the first sync.
  If it doesn't, the migrate pod stays in CreateContainerConfigError and the sync never starts:
    kubectl -n {{ .Release.Namespace }} get secret {{ include "app.dbSecretName" . }}
    kubectl -n {{ .Release.Namespace }} logs job/{{ include "app.fullname" . }}-migrate
```

## Annotations, and why only Argo's

| Annotation | Why |
|---|---|
| `argocd.argoproj.io/hook: PreSync` | Runs before Sync-phase resources, on every sync including the first |
| `argocd.argoproj.io/hook-delete-policy: BeforeHookCreation` | The next sync deletes the old Job first; with a fixed name this keeps exactly one Job and its logs |

No `helm.sh/hook`: when Argo sees any Argo hook it ignores Helm hooks, and for a plain `helm install` a Helm hook would bring semantics the chart rules exclude. Under plain Helm the Job renders as an ordinary resource that runs alongside the Deployment.

## The Secret

```sh
kubectl -n <ns> create secret generic <app>-db \
  --from-literal=DATABASE_URL='postgres://<user>:<password>@<host>:5432/<db>?sslmode=verify-full&sslrootcert=/etc/ssl/db/ca.pem'
```

Prefer External Secrets pulling from your vault. Rotate by updating the Secret and restarting the Deployment; the next migrate Job picks it up automatically.

## When the Job fails

```sh
kubectl -n <ns> get job <app>-migrate
kubectl -n <ns> logs job/<app>-migrate        # "migrate: failed: … (cause: …)"
kubectl -n <ns> describe pod -l app.kubernetes.io/name=<app>-migrate
```

| Symptom | Cause |
|---|---|
| `CreateContainerConfigError` | The Secret doesn't exist or lacks `DATABASE_URL` |
| `ImagePullBackOff` | `imagePullSecrets` missing for private GHCR |
| `DeadlineExceeded` after 10 min | A migration waits on a lock (long transaction, `ALTER TABLE` on a busy table); find the blocker with `pg_stat_activity` |
| Exit 1, SQL error | Fix forward with a new migration; the failed one was rolled back as a whole |

Fix the cause, then re-sync. The next sync deletes the failed Job (BeforeHookCreation) and runs a new one.
