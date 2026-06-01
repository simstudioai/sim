# Sim Helm Chart

Deploy [Sim](https://sim.ai) — the open-source AI workspace where teams build, deploy, and manage AI agents — on Kubernetes.

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

# Install from this repository
helm install sim ./helm/sim \
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
* **`migrations`** — a Job that applies database migrations on install/upgrade.
* **`cronjobs`** — scheduled jobs for workflow schedule execution, inbox/calendar/drive polling (Gmail, Outlook, Calendar, Drive, Sheets, IMAP, RSS), inactivity alerts, subscription renewal, data drains, and connector syncs.
* **`serviceaccount`** — a dedicated ServiceAccount with `automountServiceAccountToken: false`.

Optional components (off by default):

* **`copilot`** — the Sim Copilot service plus its own Postgres StatefulSet.
* **`ollama`** — local LLM inference, with optional NVIDIA GPU support.
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

### From this repository

```bash
helm install sim ./helm/sim \
  --namespace sim --create-namespace \
  --set app.env.BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
  --set app.env.ENCRYPTION_KEY="$ENCRYPTION_KEY" \
  --set app.env.INTERNAL_API_SECRET="$INTERNAL_API_SECRET" \
  --set app.env.CRON_SECRET="$CRON_SECRET" \
  --set postgresql.auth.password="$POSTGRES_PASSWORD"
```

### With a values file

```bash
helm install sim ./helm/sim \
  --namespace sim --create-namespace \
  --values my-values.yaml
```

Run `helm template ./helm/sim --values my-values.yaml | less` first to see what will be applied.

### Validate the install

```bash
helm install sim ./helm/sim --dry-run --debug \
  --values my-values.yaml \
  --set app.env.BETTER_AUTH_SECRET=$(openssl rand -hex 16) \
  --set app.env.ENCRYPTION_KEY=$(openssl rand -hex 16) \
  --set app.env.INTERNAL_API_SECRET=$(openssl rand -hex 16) \
  --set app.env.CRON_SECRET=$(openssl rand -hex 16) \
  --set postgresql.auth.password=$(openssl rand -base64 12 | tr -d '/+=')
```

---

## Upgrading

```bash
helm upgrade sim ./helm/sim --namespace sim --values my-values.yaml
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

Pre-built values files for common scenarios live in `helm/sim/examples/`. Each file has a header explaining when to use it and any prerequisites.

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
helm install sim ./helm/sim \
  --namespace sim --create-namespace \
  --values ./helm/sim/examples/values-production.yaml \
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
helm show values ./helm/sim

# Print the JSON Schema (used by `helm install` to validate your values)
cat ./helm/sim/values.schema.json
```

`values.yaml` is heavily commented; each top-level section explains what it controls and which sub-keys are required vs optional. For per-cloud examples and idiomatic overrides, see `examples/`.

---

## Production checklist

Before installing in production, confirm each of the following:

* **High availability** — scale `app.replicaCount > 1`. The chart auto-creates a `PodDisruptionBudget` with `minAvailable: 1`. Set `podDisruptionBudget.maxUnavailable: "25%"` for a more permissive policy or `minAvailable: "50%"` for a stricter one.
* **Pinned images** — override `image.tag` (or `image.digest`) with an explicit version. Do not rely on the chart's default tag in production.
* **Secrets management** — provide secrets via External Secrets Operator (ESO) or pre-created Kubernetes Secrets. Never commit secrets to `values.yaml`.
* **TLS / Ingress** — set the `cert-manager.io/cluster-issuer` annotation on the ingress and tune `proxy-body-size` / `proxy-read-timeout` for your workload. See commented examples in `values.yaml`.
* **Network policy egress** — review `networkPolicy.egressExceptCidrs`. Defaults block cloud metadata endpoints (`169.254.169.254/32`, `169.254.170.2/32`); add your cluster's API server CIDR for stronger isolation. Custom egress rules go in `networkPolicy.egress` (a list).
* **Namespace hardening** — label the install namespace with Pod Security Standards `restricted` enforcement (`pod-security.kubernetes.io/enforce=restricted`).
* **Env validation** — keys under `app.env`, `realtime.env`, and `copilot.env` are passed through to the application and validated at startup. The JSON Schema intentionally does not enforce `additionalProperties: false` (would break custom user envs), so typos like `OPENA_API_KEY` (instead of `OPENAI_API_KEY`) surface as missing-key errors at runtime, not at `helm install` time. Review your env block carefully.
* **Set public URLs** — `app.env.NEXT_PUBLIC_APP_URL` and `app.env.BETTER_AUTH_URL` must match your public origin (e.g. `https://sim.example.com`). Leaving them as `localhost` breaks sign-in.

---

## Secrets

The chart supports three ways to provide secrets, in increasing order of production-readiness:

### 1. Inline `--set` (dev / dry-run only)

```bash
helm install sim ./helm/sim --set app.env.BETTER_AUTH_SECRET=...
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
      name: sim-postgres-secret
      passwordKey: POSTGRES_PASSWORD
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
* Every value in `app.env` and `realtime.env` is written to a chart-managed Secret and mounted via `envFrom: secretRef` — no values are inlined on the container spec. This eliminates a sensitivity classifier (no static list of "secret" keys to maintain) and ensures new provider keys can never accidentally leak into pod manifests. Two categories are inlined on the container instead: chart-computed values (`DATABASE_URL`, `SOCKET_SERVER_URL`, `OLLAMA_URL`) and operational defaults under `app.envDefaults` / `realtime.envDefaults` (rate limits, timeouts, IVM tunables, feature-flag defaults, branding defaults, `http://localhost:3000` URL fallbacks). Operational defaults are non-sensitive by design — moving them out of `app.env` keeps the Secret small and means External Secrets Operator users only have to map the keys they actually set, not every chart default. A value placed in `app.env` always wins over the same key in `app.envDefaults` (the template skips the inline default when an override exists).
* Optional `networkPolicy.enabled=true` enforces east-west isolation and blocks cloud metadata endpoints in egress.

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

When `autoscaling.enabled=true`, the chart omits `spec.replicas` from the Deployment so the HPA owns replica count. Requires `metrics-server` in the cluster.

---

## Monitoring

```yaml
monitoring:
  serviceMonitor:
    enabled: true
    interval: 30s
```

Requires the Prometheus Operator CRDs. Scrapes `/metrics` on the app and realtime services.

---

## Troubleshooting

### `Error: execution error at (sim/templates/...): app.env.BETTER_AUTH_SECRET is required for production deployment`

You ran `helm install` without setting required secrets. Generate them and pass with `--set`:

```bash
helm install sim ./helm/sim \
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
* Missing migration → check `kubectl logs job/sim-migrations`.

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
kubectl --namespace sim logs job/sim-migrations
```

---

## Support

* **Docs:** https://docs.sim.ai
* **GitHub:** https://github.com/simstudioai/sim
* **Issues:** https://github.com/simstudioai/sim/issues
* **Discord:** https://discord.gg/Hr4UWYEcTT

---

## License

Apache-2.0 © Sim. See [LICENSE](../../LICENSE).
