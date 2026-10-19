{{/* The existing Secret that holds DATABASE_URL: db.externalSecret.name, or <fullname>-db. */}}
{{- define "app.dbSecretName" -}}
{{- default (printf "%s-db" (include "app.fullname" .)) .Values.db.externalSecret.name }}
{{- end }}
