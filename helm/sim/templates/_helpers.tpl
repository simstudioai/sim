{{/*
Expand the name of the chart.
*/}}
{{- define "simstudio.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "simstudio.fullname" -}}
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
{{- define "simstudio.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "simstudio.labels" -}}
helm.sh/chart: {{ include "simstudio.chart" . }}
{{ include "simstudio.selectorLabels" . }}
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
{{- define "simstudio.selectorLabels" -}}
app.kubernetes.io/name: {{ include "simstudio.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
App specific labels
*/}}
{{- define "simstudio.app.labels" -}}
{{ include "simstudio.labels" . }}
app.kubernetes.io/component: app
{{- end }}

{{/*
App selector labels
*/}}
{{- define "simstudio.app.selectorLabels" -}}
{{ include "simstudio.selectorLabels" . }}
app.kubernetes.io/component: app
{{- end }}

{{/*
Realtime specific labels
*/}}
{{- define "simstudio.realtime.labels" -}}
{{ include "simstudio.labels" . }}
app.kubernetes.io/component: realtime
{{- end }}

{{/*
Realtime selector labels
*/}}
{{- define "simstudio.realtime.selectorLabels" -}}
{{ include "simstudio.selectorLabels" . }}
app.kubernetes.io/component: realtime
{{- end }}

{{/*
PostgreSQL specific labels
*/}}
{{- define "simstudio.postgresql.labels" -}}
{{ include "simstudio.labels" . }}
app.kubernetes.io/component: postgresql
{{- end }}

{{/*
PostgreSQL selector labels
*/}}
{{- define "simstudio.postgresql.selectorLabels" -}}
{{ include "simstudio.selectorLabels" . }}
app.kubernetes.io/component: postgresql
{{- end }}

{{/*
Ollama specific labels
*/}}
{{- define "simstudio.ollama.labels" -}}
{{ include "simstudio.labels" . }}
app.kubernetes.io/component: ollama
{{- end }}

{{/*
Ollama selector labels
*/}}
{{- define "simstudio.ollama.selectorLabels" -}}
{{ include "simstudio.selectorLabels" . }}
app.kubernetes.io/component: ollama
{{- end }}

{{/*
Migrations specific labels
*/}}
{{- define "simstudio.migrations.labels" -}}
{{ include "simstudio.labels" . }}
app.kubernetes.io/component: migrations
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "simstudio.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "simstudio.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Create image name with registry
Expects context with image object passed as second parameter
Usage: {{ include "simstudio.image" (dict "context" . "image" .Values.app.image) }}
*/}}
{{- define "simstudio.image" -}}
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
{{- define "simstudio.databaseUrl" -}}
{{- if .Values.postgresql.enabled }}
{{- $host := printf "%s-postgresql" (include "simstudio.fullname" .) }}
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
*/}}
{{- define "simstudio.validateSecrets" -}}
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
{{- if and .Values.postgresql.enabled (not .Values.postgresql.auth.password) }}
{{- fail "postgresql.auth.password is required when using internal PostgreSQL" }}
{{- end }}
{{- if and .Values.postgresql.enabled (eq .Values.postgresql.auth.password "CHANGE-ME-SECURE-PASSWORD") }}
{{- fail "postgresql.auth.password must not use the default placeholder value. Set a secure password for production" }}
{{- end }}
{{- if and .Values.externalDatabase.enabled (not .Values.externalDatabase.password) }}
{{- fail "externalDatabase.password is required when using external database" }}
{{- end }}
{{- end }}

{{/*
Ollama URL
*/}}
{{- define "simstudio.ollamaUrl" -}}
{{- if .Values.ollama.enabled }}
{{- $serviceName := printf "%s-ollama" (include "simstudio.fullname" .) }}
{{- $port := .Values.ollama.service.port }}
{{- printf "http://%s:%v" $serviceName $port }}
{{- else }}
{{- .Values.app.env.OLLAMA_URL | default "http://localhost:11434" }}
{{- end }}
{{- end }}

{{/*
Socket Server URL (internal)
*/}}
{{- define "simstudio.socketServerUrl" -}}
{{- if .Values.realtime.enabled }}
{{- $serviceName := printf "%s-realtime" (include "simstudio.fullname" .) }}
{{- $port := .Values.realtime.service.port }}
{{- printf "http://%s:%v" $serviceName $port }}
{{- else }}
{{- .Values.app.env.SOCKET_SERVER_URL | default "http://localhost:3002" }}
{{- end }}
{{- end }}

{{/*
Resource limits and requests
*/}}
{{- define "simstudio.resources" -}}
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
{{- define "simstudio.securityContext" -}}
{{- if .securityContext }}
securityContext:
  {{- toYaml .securityContext | nindent 2 }}
{{- end }}
{{- end }}

{{/*
Pod security context
*/}}
{{- define "simstudio.podSecurityContext" -}}
{{- if .podSecurityContext }}
securityContext:
  {{- toYaml .podSecurityContext | nindent 2 }}
{{- end }}
{{- end }}

{{/*
Node selector
*/}}
{{- define "simstudio.nodeSelector" -}}
{{- if .nodeSelector }}
nodeSelector:
  {{- toYaml .nodeSelector | nindent 2 }}
{{- end }}
{{- end }}

{{/*
Tolerations
*/}}
{{- define "simstudio.tolerations" -}}
{{- if .tolerations }}
tolerations:
  {{- toYaml .tolerations | nindent 2 }}
{{- end }}
{{- end }}

{{/*
Affinity
*/}}
{{- define "simstudio.affinity" -}}
{{- if .affinity }}
affinity:
  {{- toYaml .affinity | nindent 2 }}
{{- end }}
{{- end }}