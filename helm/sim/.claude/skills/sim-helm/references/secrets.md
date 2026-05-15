# Secret Generation

The Sim chart requires four cryptographic secrets at install time. Generate them once and store them in your chosen path (see `install-paths.md`). Never reuse these across environments.

## Generate all four at once

```bash
export BETTER_AUTH_SECRET=$(openssl rand -hex 32)
export ENCRYPTION_KEY=$(openssl rand -hex 32)
export INTERNAL_API_SECRET=$(openssl rand -hex 32)
export CRON_SECRET=$(openssl rand -hex 32)

# Optional but commonly needed:
export API_ENCRYPTION_KEY=$(openssl rand -hex 32)       # MUST be exactly 64 hex chars
export POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')  # if using chart-bundled Postgres
```

## What each secret does

| Key | Purpose | Length | Rotation impact |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | Signs user session JWTs (Better Auth) | 32 bytes = 64 hex chars | Rotating invalidates all active sessions — users must re-login |
| `ENCRYPTION_KEY` | App-level encryption for sensitive fields | 32 bytes = 64 hex chars | Rotating breaks decryption of existing data — requires migration |
| `INTERNAL_API_SECRET` | Shared auth between `sim-app` ↔ `sim-realtime` pods | 32 bytes = 64 hex chars | Both deployments must roll together — temporary realtime errors during the rollout |
| `CRON_SECRET` | Authenticates scheduled CronJob pods to the app | 32 bytes = 64 hex chars | Rotating just needs `helm upgrade`; next cron run uses the new value |
| `API_ENCRYPTION_KEY` (optional) | Encrypts user-stored API keys (OpenAI tokens, etc.) at rest in Postgres | **Exactly 64 hex chars** (the app rejects other lengths) | Without it, keys are stored plain. Once set, never rotate without a migration |
| `POSTGRES_PASSWORD` (chart-bundled Postgres only) | Postgres superuser password | Any length ≥ 12 chars matching `^[a-zA-Z0-9._-]+$` | Requires Postgres pod restart + app rollout |

The `^[a-zA-Z0-9._-]+$` constraint on the Postgres password exists because the chart embeds the password into `DATABASE_URL` without URL-encoding. The `tr -d '/+='` strips the three problematic characters from `openssl rand -base64` output. The chart enforces this regex at template time.

## Storage by path

### Path A (inline `--set`)

Pass each on the command line — see `install-paths.md` Path A.

### Path B (pre-existing Kubernetes Secret)

```bash
kubectl create namespace sim
kubectl create secret generic sim-app-secrets --namespace sim \
  --from-literal=BETTER_AUTH_SECRET=$BETTER_AUTH_SECRET \
  --from-literal=ENCRYPTION_KEY=$ENCRYPTION_KEY \
  --from-literal=INTERNAL_API_SECRET=$INTERNAL_API_SECRET \
  --from-literal=CRON_SECRET=$CRON_SECRET \
  --from-literal=API_ENCRYPTION_KEY=$API_ENCRYPTION_KEY

kubectl create secret generic sim-postgres-secret --namespace sim \
  --from-literal=POSTGRES_PASSWORD=$POSTGRES_PASSWORD
```

For GitOps, run the `kubectl create secret ... --dry-run=client -o yaml` and pipe through `kubeseal` (Sealed Secrets) or `sops` before committing.

### Path C (External Secrets Operator)

Push the generated values into your secret manager first. Example for AWS Secrets Manager:

```bash
aws secretsmanager create-secret --name sim/app/better-auth-secret --secret-string "$BETTER_AUTH_SECRET"
aws secretsmanager create-secret --name sim/app/encryption-key     --secret-string "$ENCRYPTION_KEY"
aws secretsmanager create-secret --name sim/app/internal-api-secret --secret-string "$INTERNAL_API_SECRET"
aws secretsmanager create-secret --name sim/app/cron-secret        --secret-string "$CRON_SECRET"
aws secretsmanager create-secret --name sim/app/api-encryption-key --secret-string "$API_ENCRYPTION_KEY"
aws secretsmanager create-secret --name sim/postgresql/password    --secret-string "$POSTGRES_PASSWORD"
```

Then map the paths in `externalSecrets.remoteRefs.app` (see `install-paths.md` Path C).

## Rotation

Sim doesn't have built-in rotation hooks. The procedure is:

1. Generate a new value, store it.
2. `helm upgrade` (or let ESO pick up the change on its next refresh).
3. Restart the affected workloads to force re-read of `envFrom`:
   ```bash
   kubectl rollout restart deploy/sim-app deploy/sim-realtime -n sim
   ```
4. For `BETTER_AUTH_SECRET`: expect a wave of `401`s as old sessions invalidate.
5. For `ENCRYPTION_KEY` / `API_ENCRYPTION_KEY`: **do not rotate** without an explicit data migration. Existing ciphertext becomes undecryptable.

## What NOT to do

- **Don't reuse the same secret across dev/staging/prod.** A leak in one tier compromises all.
- **Don't commit secrets to git, even in private repos.** Use sealed-secrets / SOPS / ESO.
- **Don't paste secrets into Slack, Discord, GitHub issues, or screenshots.** Treat them like database passwords.
- **Don't store secrets in `values.yaml` files committed to git.** That's worse than `--set` — values files persist forever in history.
- **Don't generate secrets with weak entropy.** No `date | md5`, no `password123`, no developer's birthday. `openssl rand` or `/dev/urandom` only.
