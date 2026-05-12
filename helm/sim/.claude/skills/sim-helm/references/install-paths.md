# Install Path Selection

Three mutually-exclusive paths for the app Secret. Pick exactly one. The chart enforces this at template time.

## Decision tree

```
Is this a production install?
├── No (dev / kind / minikube / dry-run)
│     → Inline `--set` is fine. Skip to "Path A".
│
└── Yes
      │
      Do you already manage secrets with Vault / AWS Secrets Manager /
      Azure Key Vault / GCP Secret Manager / 1Password Connect?
      │
      ├── Yes → External Secrets Operator. Path C.
      │
      └── No
            │
            Do you use GitOps with Sealed Secrets, SOPS, or
            hand-managed Kubernetes Secrets?
            │
            ├── Yes → Pre-existing Secret. Path B.
            │
            └── No → Install ESO and go to Path C.
                    (Don't skip to inline `--set` for prod —
                    secrets land in `helm get values` and release history.)
```

---

## Path A — Inline `--set` (dev only)

```bash
helm install sim ./helm/sim \
  --namespace sim --create-namespace \
  --set app.env.BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  --set app.env.ENCRYPTION_KEY=$(openssl rand -hex 32) \
  --set app.env.INTERNAL_API_SECRET=$(openssl rand -hex 32) \
  --set app.env.CRON_SECRET=$(openssl rand -hex 32) \
  --set postgresql.auth.password=$(openssl rand -base64 24 | tr -d '/+=')
```

The chart generates a `Secret` named `<release>-app-secrets` containing every non-empty key from `app.env` + `realtime.env`. Both `app` and `realtime` Deployments mount it via `envFrom`.

**Risks:**
- Secrets are visible in `helm get values <release>` and `helm history <release>`.
- Anyone with read access to the release's ConfigMap (`sh.helm.release.v1.<release>.v<N>`) can recover the secrets — they're stored base64-encoded inside.

---

## Path B — Pre-existing Kubernetes Secret

Create the Secret first, then point the chart at it.

```bash
kubectl create namespace sim
kubectl create secret generic sim-app-secrets --namespace sim \
  --from-literal=BETTER_AUTH_SECRET=$(openssl rand -hex 32) \
  --from-literal=ENCRYPTION_KEY=$(openssl rand -hex 32) \
  --from-literal=INTERNAL_API_SECRET=$(openssl rand -hex 32) \
  --from-literal=CRON_SECRET=$(openssl rand -hex 32)

kubectl create secret generic sim-postgres-secret --namespace sim \
  --from-literal=POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')
```

```yaml
# values.yaml
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

**The chart cannot introspect your Secret.** If you forget a required key, the pod will fail at runtime with `CreateContainerConfigError: secret key "X" not found`. The required keys are: `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `INTERNAL_API_SECRET`, plus `CRON_SECRET` when cronjobs are enabled.

For GitOps (Sealed Secrets / SOPS), seal/encrypt the Secret YAML before committing — never commit a plain `kubectl create secret` output.

---

## Path C — External Secrets Operator (production recommended)

ESO syncs from your existing secret store (Vault, AWS SM, Azure KV, GCP SM, etc.) into a Kubernetes Secret on a refresh interval. The chart renders the `ExternalSecret` resource; ESO does the syncing.

### Prerequisites

1. Install ESO once per cluster:
   ```bash
   helm repo add external-secrets https://charts.external-secrets.io
   helm install external-secrets external-secrets/external-secrets \
     -n external-secrets --create-namespace
   ```
2. Create a `ClusterSecretStore` (or namespace-scoped `SecretStore`) that points at your secret manager. ESO's docs cover the auth wiring for each provider.

### Values

```yaml
externalSecrets:
  enabled: true
  apiVersion: v1beta1     # v1beta1 works on ESO >= 0.7. Bump to v1 only on ESO >= 0.17.
  refreshInterval: 1h
  secretStoreRef:
    name: my-cluster-secret-store
    kind: ClusterSecretStore     # or SecretStore for namespace-scoped
  remoteRefs:
    app:
      BETTER_AUTH_SECRET: sim/app/better-auth-secret
      ENCRYPTION_KEY: sim/app/encryption-key
      INTERNAL_API_SECRET: sim/app/internal-api-secret
      CRON_SECRET: sim/app/cron-secret     # required iff cronjobs.enabled
      # Optional but commonly mapped:
      API_ENCRYPTION_KEY: sim/app/api-encryption-key
      OPENAI_API_KEY: sim/providers/openai
    postgresql:
      password: sim/postgresql/password    # required if postgresql.enabled
    externalDatabase:
      password: sim/postgresql/password    # required if externalDatabase.enabled

# Leave app.env empty (or only set non-secret values like NEXT_PUBLIC_APP_URL).
app:
  env: {}
```

### Fail-fast behavior

The chart will refuse to render if:

- `externalSecrets.enabled=true` and any of `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `INTERNAL_API_SECRET` (or `CRON_SECRET` when cronjobs are enabled) is **neither** set in `app.env` **nor** mapped in `remoteRefs.app`. Error message names the missing key.
- A key is set in `app.env` with a non-empty value but not mapped in `remoteRefs.app` (would be silently dropped from the rendered Secret).

These checks catch the "renders cleanly, CrashLoopBackOffs at runtime" failure mode that plagued earlier chart versions.

### Remote ref shapes

Each `remoteRefs.app.<KEY>` value can be either:

```yaml
# Shorthand — just the path/key in the store
BETTER_AUTH_SECRET: sim/app/better-auth-secret
```

```yaml
# Full form — pass any field ESO supports
BETTER_AUTH_SECRET:
  key: sim/app/better-auth-secret
  property: value          # for stores that return JSON
  version: "v3"            # pin a specific version
  decodingStrategy: Base64 # for base64-stored values
```

---

## Cross-cutting: things that are NOT secrets

Operational tunables (rate limits, timeouts, IVM pool size, branding) live in `app.envDefaults` and `realtime.envDefaults`. They're rendered as **inline `env:`** on the Deployment, not written to the Secret. See `values-model.md` for the full mental model.

Don't try to push these into ESO — they're not sensitive, they'd just bloat the secret store.

---

## Verifying your choice

After `helm install`:

```bash
# What Secret will the pods mount?
helm template sim helm/sim -f my-values.yaml | grep -A2 "envFrom:"

# For ESO: did the ExternalSecret render?
helm template sim helm/sim -f my-values.yaml | grep -B1 -A10 "kind: ExternalSecret"

# For existingSecret: is your pre-created Secret referenced?
helm template sim helm/sim -f my-values.yaml | grep -E "name: .*-app-secrets"
```

For ESO, after `helm install`, verify the sync:

```bash
kubectl get externalsecret -n sim
kubectl describe externalsecret <release>-app-secrets -n sim
# Status should show 'SecretSynced=True'
```
