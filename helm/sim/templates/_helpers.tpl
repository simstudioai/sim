{{/*
Expand the name of the chart.
*/}}
{{- define "sim.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "sim.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "sim.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "sim.labels" -}}
helm.sh/chart: {{ include "sim.chart" . }}
{{ include "sim.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.global.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "sim.selectorLabels" -}}
app.kubernetes.io/name: {{ include "sim.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
App specific labels
*/}}
{{- define "sim.app.labels" -}}
{{ include "sim.labels" . }}
app.kubernetes.io/component: app
{{- end }}

{{/*
App selector labels
*/}}
{{- define "sim.app.selectorLabels" -}}
{{ include "sim.selectorLabels" . }}
app.kubernetes.io/component: app
{{- end }}

{{/*
Realtime specific labels
*/}}
{{- define "sim.realtime.labels" -}}
{{ include "sim.labels" . }}
app.kubernetes.io/component: realtime
{{- end }}

{{/*
Realtime selector labels
*/}}
{{- define "sim.realtime.selectorLabels" -}}
{{ include "sim.selectorLabels" . }}
app.kubernetes.io/component: realtime
{{- end }}

{{/*
PostgreSQL specific labels
*/}}
{{- define "sim.postgresql.labels" -}}
{{ include "sim.labels" . }}
app.kubernetes.io/component: postgresql
{{- end }}

{{/*
PostgreSQL selector labels
*/}}
{{- define "sim.postgresql.selectorLabels" -}}
{{ include "sim.selectorLabels" . }}
app.kubernetes.io/component: postgresql
{{- end }}

{{/*
Ollama specific labels
*/}}
{{- define "sim.ollama.labels" -}}
{{ include "sim.labels" . }}
app.kubernetes.io/component: ollama
{{- end }}

{{/*
Ollama selector labels
*/}}
{{- define "sim.ollama.selectorLabels" -}}
{{ include "sim.selectorLabels" . }}
app.kubernetes.io/component: ollama
{{- end }}

{{/*
Migrations specific labels
*/}}
{{- define "sim.migrations.labels" -}}
{{ include "sim.labels" . }}
app.kubernetes.io/component: migrations
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "sim.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "sim.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Create image name with registry
Expects context with image object passed as second parameter
Usage: {{ include "sim.image" (dict "context" . "image" .Values.app.image) }}
*/}}
{{- define "sim.image" -}}
{{- $registry := "" -}}
{{- $repository := .image.repository -}}
{{- $tag := .image.tag | toString -}}
{{- /* Use global registry for simstudioai images or when explicitly set for all images */ -}}
{{- if .context.Values.global.imageRegistry -}}
  {{- if or (hasPrefix "simstudioai/" $repository) .context.Values.global.useRegistryForAllImages -}}
    {{- $registry = .context.Values.global.imageRegistry -}}
  {{- end -}}
{{- end -}}
{{- if $registry -}}
{{- printf "%s/%s:%s" $registry $repository $tag }}
{{- else -}}
{{- printf "%s:%s" $repository $tag }}
{{- end -}}
{{- end }}

{{/*
Database URL for internal PostgreSQL
*/}}
{{- define "sim.databaseUrl" -}}
{{- if .Values.postgresql.enabled }}
{{- $host := printf "%s-postgresql" (include "sim.fullname" .) }}
{{- $port := .Values.postgresql.service.port }}
{{- $username := .Values.postgresql.auth.username }}
{{- $database := .Values.postgresql.auth.database }}
{{- $sslMode := ternary "require" "disable" .Values.postgresql.tls.enabled }}
{{- printf "postgresql://%s:$(POSTGRES_PASSWORD)@%s:%v/%s?sslmode=%s" $username $host $port $database $sslMode }}
{{- else if .Values.externalDatabase.enabled }}
{{- $host := .Values.externalDatabase.host }}
{{- $port := .Values.externalDatabase.port }}
{{- $username := .Values.externalDatabase.username }}
{{- $database := .Values.externalDatabase.database }}
{{- $sslMode := .Values.externalDatabase.sslMode }}
{{- printf "postgresql://%s:$(EXTERNAL_DB_PASSWORD)@%s:%v/%s?sslmode=%s" $username $host $port $database $sslMode }}
{{- end }}
{{- end }}

{{/*
Validate required secrets and reject default placeholder values
Skip validation when using existing secrets or External Secrets Operator
*/}}
{{- define "sim.validateSecrets" -}}
{{- $useExistingAppSecret := and .Values.app.secrets .Values.app.secrets.existingSecret .Values.app.secrets.existingSecret.enabled }}
{{- $useExternalSecrets := and .Values.externalSecrets .Values.externalSecrets.enabled }}
{{- $useExistingPostgresSecret := and .Values.postgresql.auth.existingSecret .Values.postgresql.auth.existingSecret.enabled }}
{{- $useExistingExternalDbSecret := and .Values.externalDatabase.existingSecret .Values.externalDatabase.existingSecret.enabled }}
{{- /* App secrets validation - skip if using existing secret or ESO */ -}}
{{- if not (or $useExistingAppSecret $useExternalSecrets) }}
{{- if and .Values.app.enabled (not .Values.app.env.BETTER_AUTH_SECRET) }}
{{- fail "app.env.BETTER_AUTH_SECRET is required for production deployment" }}
{{- end }}
{{- if and .Values.app.enabled (eq .Values.app.env.BETTER_AUTH_SECRET "CHANGE-ME-32-CHAR-SECRET-FOR-PRODUCTION-USE") }}
{{- fail "app.env.BETTER_AUTH_SECRET must not use the default placeholder value. Generate a secure secret with: openssl rand -hex 32" }}
{{- end }}
{{- if and .Values.app.enabled (not .Values.app.env.ENCRYPTION_KEY) }}
{{- fail "app.env.ENCRYPTION_KEY is required for production deployment" }}
{{- end }}
{{- if and .Values.app.enabled (eq .Values.app.env.ENCRYPTION_KEY "CHANGE-ME-32-CHAR-ENCRYPTION-KEY-FOR-PROD") }}
{{- fail "app.env.ENCRYPTION_KEY must not use the default placeholder value. Generate a secure key with: openssl rand -hex 32" }}
{{- end }}
{{- if and .Values.realtime.enabled (eq .Values.realtime.env.BETTER_AUTH_SECRET "CHANGE-ME-32-CHAR-SECRET-FOR-PRODUCTION-USE") }}
{{- fail "realtime.env.BETTER_AUTH_SECRET must not use the default placeholder value. Generate a secure secret with: openssl rand -hex 32" }}
{{- end }}
{{- end }}
{{- /* PostgreSQL password validation - skip if using existing secret or ESO */ -}}
{{- if not (or $useExistingPostgresSecret $useExternalSecrets) }}
{{- if and .Values.postgresql.enabled (not .Values.postgresql.auth.password) }}
{{- fail "postgresql.auth.password is required when using internal PostgreSQL" }}
{{- end }}
{{- if and .Values.postgresql.enabled (eq .Values.postgresql.auth.password "CHANGE-ME-SECURE-PASSWORD") }}
{{- fail "postgresql.auth.password must not use the default placeholder value. Set a secure password for production" }}
{{- end }}
{{- if and .Values.postgresql.enabled .Values.postgresql.auth.password (not (regexMatch "^[a-zA-Z0-9._-]+$" .Values.postgresql.auth.password)) }}
{{- fail "postgresql.auth.password must only contain alphanumeric characters, hyphens, underscores, or periods to ensure DATABASE_URL compatibility. Generate with: openssl rand -base64 16 | tr -d '/+='" }}
{{- end }}
{{- end }}
{{- /* External database password validation - skip if using existing secret or ESO */ -}}
{{- if not (or $useExistingExternalDbSecret $useExternalSecrets) }}
{{- if and .Values.externalDatabase.enabled (not .Values.externalDatabase.password) }}
{{- fail "externalDatabase.password is required when using external database" }}
{{- end }}
{{- if and .Values.externalDatabase.enabled .Values.externalDatabase.password (not (regexMatch "^[a-zA-Z0-9._-]+$" .Values.externalDatabase.password)) }}
{{- fail "externalDatabase.password must only contain alphanumeric characters, hyphens, underscores, or periods to ensure DATABASE_URL compatibility." }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Get the app secrets name
Returns the name of the secret containing app credentials (auth, encryption keys)
*/}}
{{- define "sim.appSecretName" -}}
{{- if and .Values.app.secrets .Values.app.secrets.existingSecret .Values.app.secrets.existingSecret.enabled -}}
{{- .Values.app.secrets.existingSecret.name -}}
{{- else -}}
{{- printf "%s-app-secrets" (include "sim.fullname" .) -}}
{{- end -}}
{{- end }}

{{/*
Get the PostgreSQL secret name
Returns the name of the secret containing PostgreSQL password
*/}}
{{- define "sim.postgresqlSecretName" -}}
{{- if and .Values.postgresql.auth.existingSecret .Values.postgresql.auth.existingSecret.enabled -}}
{{- .Values.postgresql.auth.existingSecret.name -}}
{{- else -}}
{{- printf "%s-postgresql-secret" (include "sim.fullname" .) -}}
{{- end -}}
{{- end }}

{{/*
Get the PostgreSQL password key name
Returns the key name in the secret that contains the password
*/}}
{{- define "sim.postgresqlPasswordKey" -}}
{{- if and .Values.postgresql.auth.existingSecret .Values.postgresql.auth.existingSecret.enabled -}}
{{- .Values.postgresql.auth.existingSecret.passwordKey | default "POSTGRES_PASSWORD" -}}
{{- else -}}
{{- print "POSTGRES_PASSWORD" -}}
{{- end -}}
{{- end }}

{{/*
Get the external database secret name
Returns the name of the secret containing external database password
*/}}
{{- define "sim.externalDbSecretName" -}}
{{- if and .Values.externalDatabase.existingSecret .Values.externalDatabase.existingSecret.enabled -}}
{{- .Values.externalDatabase.existingSecret.name -}}
{{- else -}}
{{- printf "%s-external-db-secret" (include "sim.fullname" .) -}}
{{- end -}}
{{- end }}

{{/*
Get the external database password key name
Returns the key name in the secret that contains the password
*/}}
{{- define "sim.externalDbPasswordKey" -}}
{{- if and .Values.externalDatabase.existingSecret .Values.externalDatabase.existingSecret.enabled -}}
{{- .Values.externalDatabase.existingSecret.passwordKey | default "EXTERNAL_DB_PASSWORD" -}}
{{- else -}}
{{- print "EXTERNAL_DB_PASSWORD" -}}
{{- end -}}
{{- end }}

{{/*
Check if app secrets should be created by the chart
Returns true if we should create the app secrets (not using existing or ESO)
*/}}
{{- define "sim.createAppSecrets" -}}
{{- $useExistingAppSecret := and .Values.app.secrets .Values.app.secrets.existingSecret .Values.app.secrets.existingSecret.enabled }}
{{- $useExternalSecrets := and .Values.externalSecrets .Values.externalSecrets.enabled }}
{{- if not (or $useExistingAppSecret $useExternalSecrets) -}}
true
{{- end -}}
{{- end }}

{{/*
Check if PostgreSQL secret should be created by the chart
Returns true if we should create the PostgreSQL secret (not using existing or ESO)
*/}}
{{- define "sim.createPostgresqlSecret" -}}
{{- $useExistingSecret := and .Values.postgresql.auth.existingSecret .Values.postgresql.auth.existingSecret.enabled }}
{{- $useExternalSecrets := and .Values.externalSecrets .Values.externalSecrets.enabled }}
{{- if not (or $useExistingSecret $useExternalSecrets) -}}
true
{{- end -}}
{{- end }}

{{/*
Check if external database secret should be created by the chart
Returns true if we should create the external database secret (not using existing or ESO)
*/}}
{{- define "sim.createExternalDbSecret" -}}
{{- $useExistingSecret := and .Values.externalDatabase.existingSecret .Values.externalDatabase.existingSecret.enabled }}
{{- $useExternalSecrets := and .Values.externalSecrets .Values.externalSecrets.enabled }}
{{- if not (or $useExistingSecret $useExternalSecrets) -}}
true
{{- end -}}
{{- end }}

{{/*
Ollama URL
*/}}
{{- define "sim.ollamaUrl" -}}
{{- if .Values.ollama.enabled }}
{{- $serviceName := printf "%s-ollama" (include "sim.fullname" .) }}
{{- $port := .Values.ollama.service.port }}
{{- printf "http://%s:%v" $serviceName $port }}
{{- else }}
{{- .Values.app.env.OLLAMA_URL | default "http://localhost:11434" }}
{{- end }}
{{- end }}

{{/*
Socket Server URL (internal)
*/}}
{{- define "sim.socketServerUrl" -}}
{{- if .Values.realtime.enabled }}
{{- $serviceName := printf "%s-realtime" (include "sim.fullname" .) }}
{{- $port := .Values.realtime.service.port }}
{{- printf "http://%s:%v" $serviceName $port }}
{{- else }}
{{- .Values.app.env.SOCKET_SERVER_URL | default "http://localhost:3002" }}
{{- end }}
{{- end }}

{{/*
Resource limits and requests
*/}}
{{- define "sim.resources" -}}
{{- if .resources }}
resources:
  {{- if .resources.limits }}
  limits:
    {{- toYaml .resources.limits | nindent 4 }}
  {{- end }}
  {{- if .resources.requests }}
  requests:
    {{- toYaml .resources.requests | nindent 4 }}
  {{- end }}
{{- end }}
{{- end }}

{{/*
Security context
*/}}
{{- define "sim.securityContext" -}}
{{- if .securityContext }}
securityContext:
  {{- toYaml .securityContext | nindent 2 }}
{{- end }}
{{- end }}

{{/*
Pod security context
*/}}
{{- define "sim.podSecurityContext" -}}
{{- if .podSecurityContext }}
securityContext:
  {{- toYaml .podSecurityContext | nindent 2 }}
{{- end }}
{{- end }}

{{/*
Node selector
*/}}
{{- define "sim.nodeSelector" -}}
{{- if .nodeSelector }}
nodeSelector:
  {{- toYaml .nodeSelector | nindent 2 }}
{{- end }}
{{- end }}

{{/*
Tolerations
*/}}
{{- define "sim.tolerations" -}}
{{- if .tolerations }}
tolerations:
  {{- toYaml .tolerations | nindent 2 }}
{{- end }}
{{- end }}

{{/*
Affinity
*/}}
{{- define "sim.affinity" -}}
{{- if .affinity }}
affinity:
  {{- toYaml .affinity | nindent 2 }}
{{- end }}
{{- end }}

{{/*
Copilot environment secret name
*/}}
{{- define "sim.copilot.envSecretName" -}}
{{- if and .Values.copilot.server.secret.name (ne .Values.copilot.server.secret.name "") -}}
{{- .Values.copilot.server.secret.name -}}
{{- else -}}
{{- printf "%s-copilot-env" (include "sim.fullname" .) -}}
{{- end -}}
{{- end }}

{{/*
Copilot database secret name
*/}}
{{- define "sim.copilot.databaseSecretName" -}}
{{- if .Values.copilot.postgresql.enabled -}}
{{- printf "%s-copilot-postgresql-secret" (include "sim.fullname" .) -}}
{{- else if and .Values.copilot.database.existingSecretName (ne .Values.copilot.database.existingSecretName "") -}}
{{- .Values.copilot.database.existingSecretName -}}
{{- else -}}
{{- printf "%s-copilot-database-secret" (include "sim.fullname" .) -}}
{{- end -}}
{{- end }}

{{/*
Copilot database secret key
*/}}
{{- define "sim.copilot.databaseSecretKey" -}}
{{- default "DATABASE_URL" .Values.copilot.database.secretKey -}}
{{- end }}

{{/*
Validate Copilot configuration
*/}}
{{- define "sim.copilot.validate" -}}
{{- if .Values.copilot.enabled -}}
  {{- if and (not .Values.copilot.server.secret.create) (or (not .Values.copilot.server.secret.name) (eq .Values.copilot.server.secret.name "")) -}}
    {{- fail "copilot.server.secret.name must be provided when copilot.server.secret.create=false" -}}
  {{- end -}}
  {{- if .Values.copilot.server.secret.create -}}
    {{- $env := .Values.copilot.server.env -}}
    {{- $required := list "AGENT_API_DB_ENCRYPTION_KEY" "INTERNAL_API_SECRET" "LICENSE_KEY" "SIM_BASE_URL" "SIM_AGENT_API_KEY" "REDIS_URL" -}}
    {{- range $key := $required -}}
      {{- if not (and $env (index $env $key) (ne (index $env $key) "")) -}}
        {{- fail (printf "copilot.server.env.%s is required when copilot is enabled" $key) -}}
      {{- end -}}
    {{- end -}}
    {{- $hasOpenAI := and $env (ne (default "" (index $env "OPENAI_API_KEY_1")) "") -}}
    {{- $hasAnthropic := and $env (ne (default "" (index $env "ANTHROPIC_API_KEY_1")) "") -}}
    {{- if not (or $hasOpenAI $hasAnthropic) -}}
      {{- fail "Set at least one of copilot.server.env.OPENAI_API_KEY_1 or copilot.server.env.ANTHROPIC_API_KEY_1" -}}
    {{- end -}}
  {{- end -}}
  {{- if .Values.copilot.postgresql.enabled -}}
    {{- if or (not .Values.copilot.postgresql.auth.password) (eq .Values.copilot.postgresql.auth.password "") -}}
      {{- fail "copilot.postgresql.auth.password is required when copilot.postgresql.enabled=true" -}}
    {{- end -}}
  {{- else -}}
    {{- if and (or (not .Values.copilot.database.existingSecretName) (eq .Values.copilot.database.existingSecretName "")) (or (not .Values.copilot.database.url) (eq .Values.copilot.database.url "")) -}}
      {{- fail "Provide copilot.database.existingSecretName or copilot.database.url when copilot.postgresql.enabled=false" -}}
    {{- end -}}
  {{- end -}}
{{- end -}}
{{- end }}