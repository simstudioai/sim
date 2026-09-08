# Sim Helm Chart

Deploy [Sim](https://sim.ai) — the open-source AI workspace where teams build, deploy, and manage AI agents — on Kubernetes.

* **Registry:** `oci://ghcr.io/simstudioai/charts/sim`
* **Helm repository:** `https://charts.sim.ai`
* **Chart version:** see `Chart.yaml`
* **App version:** tracks the upstream Sim release
* **Kubernetes:** 1.25+
* **License:** Apache-2.0

---

## TL;DR

```bash
# Generate required secrets
export BETTER_AUTH_SECRET=$(openssl rand -hex 32)
export ENCRYPTION_KEY=$(openssl rand -hex 32)
export INTERNAL_API_SECRET=$(openssl rand -hex 32)
export CRON_SECRET=$(openssl rand -hex 32)
export POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')

# Install from the registry
helm install sim oci://ghcr.io/simstudioai/charts/sim \
  --version 1.9.5 \
  --namespace sim --create-namespace \
  --set app.env.BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
  --set app.env.ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  --set app.env.INTERNAL_API_SECRET="$INTERNAL_API_SECRET" \
  --set app.env.CRON_SECRET="$CRON_SECRET" \
  --set postgresql.auth.password="$POSTGRES_PASSWORD"
```

After install, follow the on-screen `NOTES.txt` to reach the app.

---

## Introduction

This chart deploys the Sim platform on a Kubernetes cluster using the Helm package manager. A default install includes:

* **`app`** — the Sim Next.js web application (Deployment).
* **`realtime`** — the WebSocket service for live workflow updates (Deployment).
* **`postgresql`** — an in-cluster `pgvector/pgvector` Postgres (StatefulSet, with a headless Service for stable per-pod DNS).
* **`migrations`** — an init container on the app Deployment that applies database migrations before each app pod starts.
* **`cronjobs`** — scheduled jobs for workflow schedule execution, inbox/calendar/drive polling (Gmail, Outlook, Calendar, Drive, Sheets, IMAP, RSS), workspace event and HubSpot webhook polling, outbox processing, subscription renewal, billing-seat and inbox-entitlement reconciliation, time-pause/resume polling, data drains, and connector syncs.
* **`serviceaccount`** — a dedicated ServiceAccount with `automountServiceAccountToken: false`.

Optional components (off by default):

* **`copilot`** — the Sim Copilot service plus its own Postgres StatefulSet.
* **`ollama`** — local LLM inference, with optional NVIDIA GPU support.
* **`pii`** — Presidio PII redaction service (analyzer + anonymizer) for the Guardrails PII block and log redaction. See [PII redaction](#pii-redaction).
* **`telemetry`** — OpenTelemetry Collector wired to Jaeger / Prometheus / OTLP backends.
* **`ingress`** — NGINX-style Ingress for the app and realtime services.
* **`networkPolicy`** — east-west and egress isolation (blocks cloud metadata endpoints by default).
* **`hpa`** — HorizontalPodAutoscaler for `app` and `realtime`.
* **`podDisruptionBudget`** — auto-activates when `replicaCount > 1`.
* **`servicemonitor`** — Prometheus Operator integration.

---

## Prerequisites

| Requirement | Version / Notes |
|---|---|
| Kubernetes | **1.25+** (`Chart.yaml` enforces `kubeVersion: ">=1.25.0-0"`) |
| Helm | **3.8+** |
| StorageClass | A default StorageClass that supports `ReadWriteOnce` PVCs (for Postgres, Ollama). Set `global.storageClass` to pick a non-default class. |
| Ingress controller | Only if `ingress.enabled=true`. The chart's defaults assume `nginx`. |
| cert-manager | Only if you want auto-issued TLS certificates. See [cert-manager docs](https://cert-manager.io/docs/). |
| metrics-server | Only if `autoscaling.enabled=true` (HPA needs metrics). |
| External Secrets Operator | Only if `externalSecrets.enabled=true`. See [ESO docs](https://external-secrets.io/). |
| Prometheus Operator | Only if `monitoring.serviceMonitor.enabled=true`. |
| Namespace PSS labels | Recommended: `pod-security.kubernetes.io/enforce=restricted`. The chart's pod and container security contexts are PSS-restricted by default. |

---

## Generate required secrets

Sim will not start without these. Generate them once and feed them via `--set`, an existing Kubernetes Secret, or External Secrets Operator.

```bash
# Application secrets (32 bytes hex each)
openssl rand -hex 32   # BETTER_AUTH_SECRET    - signs auth JWTs
openssl rand -hex 32   # ENCRYPTION_KEY        - encrypts sensitive env vars
openssl rand -hex 32   # INTERNAL_API_SECRET   - service-to-service auth
openssl rand -hex 32   # CRON_SECRET           - required if cronjobs.enabled (default true)
openssl rand -hex 32   # API_ENCRYPTION_KEY    - optional; encrypts user API keys at rest

# Postgres password
openssl rand -base64 24 | tr -d '/+='
```

If you set `app.secrets.existingSecret.enabled=true` and point at a pre-created Secret, you do **not** also pass these via `--set` — pick one path.

---

## Installing the chart

### From the registry

The chart is published to GitHub Container Registry as an OCI artifact. This is
the supported install path — no clone, no `helm repo add`, and every version is
immutable once published.

```bash
# List the published versions
helm show chart oci://ghcr.io/simstudioai/charts/sim --version 1.9.5

helm install sim oci://ghcr.io/simstudioai/charts/sim \
  --version 1.9.5 \
  --namespace sim --create-namespace \
  --set app.env.BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
  --set app.env.ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  --set app.env.INTERNAL_API_SECRET="$INTERNAL_API_SECRET" \
  --set app.env.CRON_SECRET="$CRON_SECRET" \
  --set postgresql.auth.password="$POSTGRES_PASSWORD"
```

Always pass `--version`. Without it Helm resolves to the newest published
version at install time, which makes the same command produce different
deployments on different days.

To mirror the chart into an internal registry — the usual requirement for an
air-gapped or internal-only cluster:

```bash
helm pull oci://ghcr.io/simstudioai/charts/sim --version 1.9.5
helm push sim-1.9.5.tgz oci://registry.internal.example.com/charts
```

The container images the chart references are listed in
[`images.yaml`](./images.yaml); mirror those alongside it.

### From the Helm repository

The chart is also published to a classic Helm repository, for clusters and
tooling that consume `helm repo add` rather than OCI.

```bash
helm repo add sim https://charts.sim.ai
helm repo update

helm install sim sim/sim \
  --version 1.9.5 \
  --namespace sim --create-namespace \
  --set app.env.BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
  --set app.env.ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  --set app.env.INTERNAL_API_SECRET="$INTERNAL_API_SECRET" \
  --set app.env.CRON_SECRET="$CRON_SECRET" \
  --set postgresql.auth.password="$POSTGRES_PASSWORD"
```

Both paths serve the same chart. Prefer OCI where you can: the signature and
provenance described in [Verifying the chart](#verifying-the-chart) are attached
to the OCI artifact, and `helm repo add` has no equivalent.

### From a checkout

```bash
helm install sim ./helm/sim \
  --namespace sim --create-namespace \
  --set app.env.BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
  --set app.env.ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  --set app.env.INTERNAL_API_SECRET="$INTERNAL_API_SECRET" \
  --set app.env.CRON_SECRET="$CRON_SECRET" \
  --set postgresql.auth.password="$POSTGRES_PASSWORD"
```

The remaining examples in this README use the OCI reference. If you are working
from a checkout, substitute `./helm/sim` and drop `--version` — the commands are
otherwise identical.

### With a values file

```bash
helm install sim oci://ghcr.io/simstudioai/charts/sim \
  --version 1.9.5 \
  --namespace sim --create-namespace \
  --values my-values.yaml
```

Run `helm template oci://ghcr.io/simstudioai/charts/sim --version 1.9.5 --values my-values.yaml | less` first to
see what will be applied.

### Validate the install

```bash
helm install sim oci://ghcr.io/simstudioai/charts/sim --version 1.9.5 --dry-run --debug \
  --values my-values.yaml \
  --set app.env.BETTER_AUTH_SECRET=$(openssl rand -hex 16) \
  --set app.env.ENCRYPTION_KEY=$(openssl rand -hex 16) \
  --set app.env.INTERNAL_API_SECRET=$(openssl rand -hex 16) \
  --set app.env.CRON_SECRET=$(openssl rand -hex 16) \
  --set postgresql.auth.password=$(openssl rand -base64 12 | tr -d '/+=')
```

---

## Verifying the chart

Every published version is signed with [Sigstore](https://www.sigstore.dev/)
keyless signing and carries a SLSA build-provenance attestation, both stored in
the registry next to the chart so they survive a mirror.

```bash
# The signature: proves this chart was signed by a GitHub Actions run in this repo
cosign verify oci://ghcr.io/simstudioai/charts/sim:1.9.5 \
  --certificate-identity-regexp '^https://github.com/simstudioai/sim/' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com

# The provenance: proves which workflow, commit, and runner produced it
gh attestation verify oci://ghcr.io/simstudioai/charts/sim:1.9.5 --repo simstudioai/sim
```

There is no GPG `.prov` file — signing is Sigstore-only, so there is no
long-lived private key to hold or rotate. `helm install --verify` expects the
GPG provenance format and will not work; use `cosign verify` above.

> **Requires cosign v3.0 or newer.** Signatures use the Sigstore protobuf bundle format, which cosign v3 writes by default and cosign v2 cannot read. cosign v3.1+ auto-detects both formats.

## Upgrading

```bash
helm upgrade sim oci://ghcr.io/simstudioai/charts/sim --version 1.9.5 --namespace sim --values my-values.yaml
```

---

## Uninstalling

```bash
helm uninstall sim --namespace sim
```

**PVCs are not deleted by `helm uninstall`.** If you want to wipe data too:

```bash
# WARNING: this destroys all Postgres, Ollama, and shared-storage data.
kubectl delete pvc --namespace sim \
  -l app.kubernetes.io/instance=sim

# Or list and delete by name
kubectl get pvc --namespace sim
kubectl delete pvc <pvc-name> --namespace sim

# Then delete the namespace if you're done with it
kubectl delete namespace sim
```

---

## Examples

Pre-built values files for common scenarios live in [`helm/sim/examples/`](https://github.com/simstudioai/sim/tree/main/helm/sim/examples). Each file has a header explaining when to use it and any prerequisites. They are **not** part of the packaged chart, so fetch the one you want at a release tag rather than expecting it locally.

| File | When to use |
|---|---|
| `values-development.yaml` | Local dev / `kind` / `minikube`. Minimal resources, no TLS. |
| `values-production.yaml` | Generic production: HA, network policy, autoscaling, monitoring. |
| `values-aws.yaml` | EKS — EBS GP3 storage, ALB ingress, IRSA-friendly. |
| `values-gcp.yaml` | GKE — Persistent Disk storage, GCP managed certs, Workload Identity. |
| `values-azure.yaml` | AKS — managed-csi storage, NGINX ingress, GPU node pools. |
| `values-external-db.yaml` | Production with a managed Postgres (RDS, Cloud SQL, Azure DB). |
| `values-external-secrets.yaml` | Sync secrets from Vault / AWS SM / Azure KV / GCP SM via External Secrets Operator. |
| `values-existing-secret.yaml` | GitOps / Sealed Secrets / SOPS — reference pre-created Kubernetes Secrets. |
| `values-copilot.yaml` | Enables the Copilot service + its Postgres StatefulSet. |
| `values-whitelabeled.yaml` | Custom branding (logo, name, support links). |

Use one with:

```bash
SIM_RELEASE=v0.8.24
curl -fsSLO "https://raw.githubusercontent.com/simstudioai/sim/$SIM_RELEASE/helm/sim/examples/values-production.yaml"

helm install sim oci://ghcr.io/simstudioai/charts/sim \
  --version 1.9.5 \
  --namespace sim --create-namespace \
  --values values-production.yaml \
  --set app.env.BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
  --set app.env.ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  --set app.env.INTERNAL_API_SECRET="$INTERNAL_API_SECRET" \
  --set postgresql.auth.password="$POSTGRES_PASSWORD"
```

---

## Parameters

This chart is intentionally configurable. Rather than maintain a hand-curated parameter table (which would drift), read the canonical sources:

```bash
# Print all values with comments and defaults
helm show values oci://ghcr.io/simstudioai/charts/sim --version 1.9.5
```

The JSON Schema that `helm install` validates your values against ships inside
the chart as `values.schema.json`; read it in the
[repository](https://github.com/simstudioai/sim/blob/main/helm/sim/values.schema.json)
or extract it from a pulled chart with `helm pull --untar`.

`values.yaml` is heavily commented; each top-level section explains what it controls and which sub-keys are required vs optional. For per-cloud examples and idiomatic overrides, see `examples/`.

---

## Production checklist

Before installing in production, confirm each of the following:

* **High availability** — scale `app.replicaCount > 1`. The chart auto-creates a `PodDisruptionBudget` with `maxUnavailable: "25%"`. Set `podDisruptionBudget.minAvailable` instead for a stricter policy.
* **Pinned images** — override `image.tag` (or `image.digest`) with an explicit version. Do not rely on the chart's default tag in production.
* **Secrets management** — provide secrets via External Secrets Operator (ESO) or pre-created Kubernetes Secrets. Never commit secrets to `values.yaml`.
* **TLS / Ingress** — set the `cert-manager.io/cluster-issuer` annotation on the ingress and tune `proxy-body-size` / `proxy-read-timeout` for your workload. See commented examples in `values.yaml`.
* **Network policy egress** — review `networkPolicy.egressExceptCidrs`. Defaults block cloud metadata endpoints (`169.254.169.254/32`, `169.254.170.2/32`); add your cluster's API server CIDR for stronger isolation. Custom egress rules go in `networkPolicy.egress` (a list).

  **Every datastore you run outside the chart needs its own egress rule.** The default policy allows HTTPS (443) plus the bundled Postgres and Redis by pod selector — nothing else on a non-443 port. So a managed Postgres, a managed Redis, or any `REDIS_URL` you supply through a Secret is reachable only if you add a rule for it. This bites hardest when the URL comes from a Secret, because the chart cannot see the host and cannot generate the rule for you:

  ```yaml
  networkPolicy:
    enabled: true
    egress:
      - to:
          - ipBlock:
              cidr: 10.0.0.0/16   # your VPC / managed-service subnet
        ports:
          - protocol: TCP
            port: 6379           # managed Redis
          - protocol: TCP
            port: 5432           # managed Postgres
  ```

  If you would rather not maintain CIDR lists, `networkPolicy.allowExternalEgress: true` drops the port restriction entirely while still blocking the cloud metadata endpoints. It defaults to `false` — this chart is deliberately stricter than the common chart default of unrestricted egress.
* **Network policy ingress** — `networkPolicy.ingressFrom` defaults to `[{}]` (an empty peer selector), which allows ingress traffic from **any pod in the cluster**, not just your ingress controller. This is a deliberate simple default, not a locked-down one. On a shared or multi-tenant cluster, scope it down, e.g. to the ingress-nginx namespace:
  ```yaml
  networkPolicy:
    ingressFrom:
      - namespaceSelector:
          matchLabels:
            kubernetes.io/metadata.name: ingress-nginx
  ```
* **Namespace hardening** — label the install namespace with Pod Security Standards `restricted` enforcement (`pod-security.kubernetes.io/enforce=restricted`). All workloads set `runAsNonRoot`, drop all Linux capabilities, disable privilege escalation, and set `seccompProfile: RuntimeDefault` — the four controls the Restricted profile requires. `readOnlyRootFilesystem` is intentionally **not** defaulted anywhere (Postgres/Ollama genuinely need a writable root; the stateless services — `realtime`, `pii`, `copilot` — could tolerate it but aren't pre-wired with a `/tmp` `emptyDir`). If your policy requires it, set `<component>.securityContext.readOnlyRootFilesystem: true` and mount an `emptyDir` at `/tmp` yourself via `extraVolumes`/`extraVolumeMounts`.
* **Env validation** — keys under `app.env`, `realtime.env`, and `copilot.server.env` are passed through to the application and validated at startup. The JSON Schema intentionally does not enforce `additionalProperties: false` (would break custom user envs), so typos like `OPENA_API_KEY` (instead of `OPENAI_API_KEY`) surface as missing-key errors at runtime, not at `helm install` time. Review your env block carefully.
* **Set public URLs** — `app.env.NEXT_PUBLIC_APP_URL` and `app.env.BETTER_AUTH_URL` must match your public origin (e.g. `https://sim.example.com`). Leaving them as `localhost` breaks sign-in.

---

## Secrets

The chart supports three ways to provide secrets, in increasing order of production-readiness:

### 1. Inline `--set` (dev / dry-run only)

```bash
helm install sim oci://ghcr.io/simstudioai/charts/sim --version 1.9.5 --set app.env.BETTER_AUTH_SECRET=...
```

Discouraged for production — values land in `helm get values` output.

### 2. Pre-existing Kubernetes Secret

Create the Secret first, then reference it:

```bash
kubectl create secret generic sim-app-secrets --namespace sim \
  --from-literal=BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  --from-literal=ENCRYPTION_KEY=$(openssl rand -hex 32) \
  --from-literal=INTERNAL_API_SECRET=$(openssl rand -hex 32) \
  --from-literal=CRON_SECRET=$(openssl rand -hex 32)

kubectl create secret generic sim-postgres-secret --namespace sim \
  --from-literal=POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')
```

```yaml
app:
  secrets:
    existingSecret:
      enabled: true
      name: sim-app-secrets

postgresql:
  auth:
    existingSecret:
      enabled: true
      name: sim-postgres-secret   # must contain the password under the key POSTGRES_PASSWORD
```

See `examples/values-existing-secret.yaml`.

### 3. External Secrets Operator (recommended)

Sync from Azure Key Vault, AWS Secrets Manager, HashiCorp Vault, or GCP Secret Manager. Install ESO once, create a `ClusterSecretStore`, then:

```yaml
externalSecrets:
  enabled: true
  refreshInterval: 1h
  secretStoreRef:
    name: my-secret-store
    kind: ClusterSecretStore
  remoteRefs:
    app:
      BETTER_AUTH_SECRET: sim/app/better-auth-secret
      ENCRYPTION_KEY: sim/app/encryption-key
      INTERNAL_API_SECRET: sim/app/internal-api-secret
    postgresql:
      password: sim/postgresql/password
    # Only needed when copilot.enabled=true and copilot.server.secret.create=true.
    # Every non-empty copilot.server.env key must have a matching entry here —
    # template rendering fails with a clear message naming the missing key otherwise.
    copilot:
      AGENT_API_DB_ENCRYPTION_KEY: sim/copilot/agent-api-db-encryption-key
      INTERNAL_API_SECRET: sim/copilot/internal-api-secret
      LICENSE_KEY: sim/copilot/license-key
      SIM_BASE_URL: sim/copilot/sim-base-url
      SIM_AGENT_API_KEY: sim/copilot/sim-agent-api-key
      REDIS_URL: sim/copilot/redis-url
      OPENAI_API_KEY_1: sim/copilot/openai-api-key
```

See `examples/values-external-secrets.yaml`.

---

## Persistence

Postgres, Ollama, and any configured `sharedStorage.volumes[]` use PersistentVolumeClaims. PVCs **survive `helm uninstall`** — see [Uninstalling](#uninstalling) for full cleanup.

| Component | Default size | Access mode | Storage class |
|---|---|---|---|
| `postgresql` | 10Gi | `ReadWriteOnce` | `global.storageClass` |
| `copilot.postgresql` | 10Gi | `ReadWriteOnce` | `global.storageClass` |
| `ollama` | 100Gi | `ReadWriteOnce` | `global.storageClass` |
| `sharedStorage.volumes[]` | user-defined | `ReadWriteMany` recommended | `sharedStorage.storageClass` |

For production, use a `StorageClass` with `reclaimPolicy: Retain` on database volumes.

---

## Security

The chart applies [Pod Security Standards `restricted`](https://kubernetes.io/docs/concepts/security/pod-security-standards/) defaults to every workload:

* `runAsNonRoot: true`
* `allowPrivilegeEscalation: false`
* `capabilities.drop: [ALL]`
* `seccompProfile.type: RuntimeDefault`

User-supplied `securityContext` values are merged with the defaults — your values win, but you don't have to repeat the defaults.

Other security features:

* `automountServiceAccountToken: false` on the ServiceAccount **and** every pod.
* Every value in `app.env` and `realtime.env` is written to a chart-managed Secret and mounted via `envFrom: secretRef` — no values are inlined on the container spec. This eliminates a sensitivity classifier (no static list of "secret" keys to maintain) and ensures new provider keys can never accidentally leak into pod manifests. Two categories are inlined on the container instead: chart-computed values (`DATABASE_URL`, `SOCKET_SERVER_URL`, `OLLAMA_URL`, `PII_URL`) and operational defaults under `app.envDefaults` / `realtime.envDefaults` (rate limits, timeouts, IVM tunables, feature-flag defaults, branding defaults, `http://localhost:3000` URL fallbacks). Operational defaults are non-sensitive by design — moving them out of `app.env` keeps the Secret small and means External Secrets Operator users only have to map the keys they actually set, not every chart default. A **non-empty** value placed in `app.env` wins over the same key in `app.envDefaults` (the template skips the inline default when an override exists). An **empty** value does not — to remove a key rather than change it, see [Removing an inherited env key](#removing-an-inherited-env-key).
* Optional `networkPolicy.enabled=true` enforces east-west isolation and blocks cloud metadata endpoints in egress.

---

## Removing an inherited env key

To remove a key the chart (or an older values file) sets, override it with `null` — [Helm's documented way](https://helm.sh/docs/chart_template_guide/values_files/) to delete a default key:

```yaml
app:
  envDefaults:
    FREE_TABLES_LIMIT: null
    FREE_TABLE_ROWS_LIMIT: null
```

Or on the CLI: `--set app.envDefaults.FREE_TABLES_LIMIT=null`.

**Null the key in every layer that sets it.** `null` deletes the key from the map you null, not from the pod — so if a key is set in both `app.env` and `app.envDefaults`, nulling only the `app.env` entry makes the inline `envDefaults` value apply again and the variable stays on the pod. The same holds for `realtime.env` / `realtime.envDefaults`. Under ESO there is a third source: a key mapped in `externalSecrets.remoteRefs.app` keeps being synced into the Secret regardless of `app.env`, so remove that mapping too. Rendering the manifest (below) is the reliable way to confirm the key is actually gone.

**Setting the key to `""` instead does not remove it.** Every key under `app.env` in `values.yaml` ships as a `""` placeholder, so the templates have to treat an empty string as "the operator said nothing" — if they did not, the ten placeholders that collide with a real `app.envDefaults` value (`NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_BRAND_NAME`, `VERTEX_LOCATION`, `EMAIL_VERIFICATION_ENABLED`, …) would blank themselves out on every default install. An empty entry is a silent no-op; `null` is the deletion.

With the chart-managed Secret (the default), nulling a key the application cannot start without (`BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `INTERNAL_API_SECRET`, or `CRON_SECRET` with `cronjobs.enabled=true`) fails at template time with the existing required-secret error rather than at runtime. In `existingSecret` mode the chart skips that validation entirely — those values come from your pre-created Secret, which the chart cannot read — so a null there renders successfully and the key is simply absent from `app.env`. Under ESO the key must still be mapped in `externalSecrets.remoteRefs.app`, which is validated at template time.

> **Caveats.** `null` deletion does not take effect under `helm upgrade --reuse-values` ([helm#30765](https://github.com/helm/helm/issues/30765)) — pass your full values with `-f`, or use `--reset-then-reuse-values` (Helm ≥ 3.14).
>
> On **Argo CD**, put the `null` in `spec.source.helm.valueFiles` or the `values` string. Argo CD strips nulls from the structured `valuesObject` field ([argo-cd#16312](https://github.com/argoproj/argo-cd/issues/16312), [#19781](https://github.com/argoproj/argo-cd/issues/19781)), so a null written there silently does nothing.

The common case is a free-tier cap inherited from a chart release older than the one that stopped presetting them, which shipped `FREE_TABLES_LIMIT: "3"` and `FREE_TABLE_ROWS_LIMIT: "1000"` under `app.envDefaults`. With billing disabled, Sim reads an unset limit as unlimited, so nulling these lifts the cap. Verify before rolling out:

```bash
helm template sim oci://ghcr.io/simstudioai/charts/sim --version 1.9.5 -f values.yaml | grep -A1 FREE_TABLE   # expect no output
```

---

## Autoscaling

```yaml
autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 20
  targetCPUUtilizationPercentage: 70
  targetMemoryUtilizationPercentage: 80
```

When `autoscaling.enabled=true`, the chart omits `spec.replicas` from the Deployment so the HPA owns replica count. Requires `metrics-server` in the cluster. The realtime Deployment gets the same HPA unless `autoscaling.realtime.enabled=false` — scale realtime past one replica only with `REDIS_URL` set (Socket.IO Redis adapter), or cross-pod collaboration events are dropped.

---

## Monitoring

```yaml
monitoring:
  serviceMonitor:
    enabled: true
    interval: 30s
```

Requires the Prometheus Operator CRDs. Scrapes `/metrics` on the app and realtime services — note the default images do not currently expose a `/metrics` endpoint, so enable this only with a build that does.

---

## PII redaction

Sim can redact personally identifiable information using a [Presidio](https://microsoft.github.io/presidio/) service (analyzer + anonymizer combined into one image listening on port 5001). Enable it with:

```yaml
pii:
  enabled: true
```

When enabled, the chart deploys it as a standalone `<release>-pii` Deployment + Service and **auto-wires** `PII_URL` on the app to the in-cluster service. The service bundles five large spaCy models (en/es/it/pl/fi, ~2.2GB), so the first start takes ~3 minutes while models load — the `startupProbe` allows for this. Size the `pii.resources` for at least ~4Gi memory.

This powers the **Guardrails PII block**, on-demand masking, and PII policies configured under **Settings → Enterprise → Data Retention**. Automatic redaction also requires the app to reach its own masking endpoint:

```yaml
app:
  env:
    # The log-redaction path calls the app's own /api/guardrails/mask-batch,
    # which must be reachable from inside the cluster. Set this to the in-cluster
    # app Service URL (NOT the public ingress, which usually isn't hairpin-reachable).
    INTERNAL_API_BASE_URL: "http://<release>-app.<namespace>.svc.cluster.local:3000"
```

Without a cluster-reachable `INTERNAL_API_BASE_URL` (it falls back to `NEXT_PUBLIC_APP_URL`), the redaction path fails closed — it scrubs affected fields to `[REDACTION_FAILED]` rather than leaking, but redaction won't actually run.

> The PII image is published at `ghcr.io/simstudioai/pii` (multi-arch). If you mirror images into a private registry, retag it alongside the app/realtime/migrations images.

---

## Troubleshooting

### `Error: execution error at (sim/templates/...): app.env.BETTER_AUTH_SECRET is required for production deployment`

You ran `helm install` without setting required secrets. Generate them and pass with `--set`:

```bash
helm install sim oci://ghcr.io/simstudioai/charts/sim --version 1.9.5 \
  --set app.env.BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  --set app.env.ENCRYPTION_KEY=$(openssl rand -hex 32) \
  --set app.env.INTERNAL_API_SECRET=$(openssl rand -hex 32) \
  --set postgresql.auth.password=$(openssl rand -base64 24 | tr -d '/+=')
```

### App pods stuck in `CrashLoopBackOff`

```bash
kubectl logs --namespace sim deploy/sim-app --tail 200
```

Common causes:

* `NEXT_PUBLIC_APP_URL` still set to `http://localhost:3000` in a clustered deploy → set it to your public origin.
* `DATABASE_URL` not reachable → check the Postgres pod is running and `postgresql.auth.password` matches.
* Missing migration → check `kubectl logs deploy/sim-app -c migrations` (migrations run as an init container on the app pod).

### Image pull errors (`ErrImagePull` / `ImagePullBackOff`)

* You pushed Sim to a private registry but haven't configured pull secrets. Set `global.imagePullSecrets` and `global.imageRegistry`.
* You overrode `image.tag` to a tag that doesn't exist in the registry. `helm get values sim` and verify.

### Postgres pod `Pending`

```bash
kubectl describe pvc --namespace sim
```

Almost always one of:

* No default `StorageClass` → set `global.storageClass`.
* No PV provisioner → install one (e.g. EBS CSI on EKS, `local-path-provisioner` for dev).
* StorageClass exists but doesn't support `ReadWriteOnce` → pick another class.

### Ingress not routing

```bash
kubectl get ingress --namespace sim
kubectl describe ingress --namespace sim
```

* Ingress controller not installed → install `ingress-nginx` or similar.
* `ingress.className` doesn't match your controller → set it to your installed class.
* DNS not pointed at the ingress's external IP / LoadBalancer.

### Get logs from each component

```bash
kubectl --namespace sim logs -f deployment/sim-app
kubectl --namespace sim logs -f deployment/sim-realtime
kubectl --namespace sim logs -f statefulset/sim-postgresql
kubectl --namespace sim logs deploy/sim-app -c migrations
```

---

## Upgrading to 1.6.4

* `appVersion` — the default image tag for every first-party image (`app`, `realtime`, `migrations`, `pii`, `copilot`) when `image.tag` is unset — moves from `v0.7.44` to `v0.8.18`. It had not been bumped since chart 1.2.0, so an unpinned install deployed an application dozens of releases behind the chart it shipped with, and values keys added by newer charts had no effect because the running image did not read them. **An unpinned release rolls every first-party pod on upgrade.** Installs that pin `image.tag` or `image.digest` are unaffected; pinning explicitly remains the recommendation for production.

## Upgrading to 1.5.0

Two changes alter behavior on an existing release. Neither requires action, but read both.

* **Free-tier plan limits are no longer preset.** `app.envDefaults` previously shipped `RATE_LIMIT_FREE_SYNC`, `RATE_LIMIT_FREE_ASYNC`, `EXECUTION_TIMEOUT_FREE`, `EXECUTION_TIMEOUT_ASYNC_FREE`, `FREE_TABLES_LIMIT: 3`, and `FREE_TABLE_ROWS_LIMIT: 1000`. With billing disabled the application treats these as **opt-in** — unset means unlimited — so presetting them imposed hosted-plan caps on self-hosted deployments and diverged from Docker Compose, which presets nothing. They are now commented out. **On upgrade, these limits stop being enforced.** To keep them, set the keys explicitly under `app.env`. An explicitly set value has always taken precedence and is unaffected.

* **Redis is now bundled** (`redis.enabled: true`), matching the Docker Compose stack. Redis backs pub/sub and the Socket.IO adapter, and multi-replica deployments silently drop cross-pod events without it.

  **An existing `REDIS_URL` always wins, wherever it comes from — no action needed on upgrade.** The bundled URL ships as a ConfigMap listed *before* the app Secret in `envFrom`. Kubernetes resolves duplicate keys by letting the last source win, so a `REDIS_URL` in your chart-managed Secret, a pre-created `existingSecret`, or one synced by External Secrets overrides the bundled value — the chart never has to read it. The bundled Redis simply fills the gap when nothing else provides a URL.

  Set `app.env.REDIS_URL` to skip the bundled Deployment entirely (no unused pod), or `redis.enabled: false` to opt out.

## Upgrading to 1.2.0

* `appVersion` (the default image tag when `image.tag` is unset) is now `v0.7.44` — the previous `0.6.73` referenced a tag that does not exist on GHCR, so an unpinned default install could not pull images. Production installs should still pin `image.tag` explicitly.
* `externalSecrets.apiVersion` now defaults to `"v1"` — current External Secrets Operator releases no longer serve `v1beta1` (removed upstream in 2026). Set `externalSecrets.apiVersion: "v1beta1"` only if you still run ESO < 0.17.
* `values.schema.json` now declares every top-level key and rejects unknown top-level keys, so a typo like `networkPolciy:` fails fast at install time instead of being silently ignored. If an upgrade suddenly fails schema validation, check your values file for stray top-level keys.
* The opt-in telemetry collector no longer ships a Prometheus scrape config for the app/realtime services (they expose no `/metrics` endpoint); OTLP ingestion is unchanged.

## Upgrading to 1.1.0

No action is required for working configurations. Notes:

* Pods for `app` and `realtime` roll once on upgrade (their rollout checksum now also covers the ExternalSecret manifest, fixing missed rollouts in ESO mode).
* Two values keys that were never consumed by any template were removed: `app.secrets.existingSecret.keys` and `*.existingSecret.passwordKey`. Existing secrets must use the standard key names (`BETTER_AUTH_SECRET`, ..., `POSTGRES_PASSWORD`, `EXTERNAL_DB_PASSWORD`); leftover keys in your values file are ignored, not rejected.
* `telemetry.jaeger` now exports over OTLP (`otlp/jaeger`) — point `telemetry.jaeger.endpoint` at Jaeger's OTLP gRPC port (4317). The previous `jaeger` exporter did not exist in the pinned collector image, so any prior jaeger-enabled config was already failing at collector startup.

## Support

* **Docs:** https://docs.sim.ai
* **GitHub:** https://github.com/simstudioai/sim
* **Issues:** https://github.com/simstudioai/sim/issues
* **Slack:** https://join.slack.com/t/sim-ott9864/shared_invite/zt-43lp8tc5v-0qrrqHGBKUsvQlpoouH~TA

---

## License

Apache-2.0 © Sim. See [LICENSE](../../LICENSE).
