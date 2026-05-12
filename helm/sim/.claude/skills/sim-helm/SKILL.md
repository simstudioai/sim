---
name: sim-helm
description: Install, upgrade, and operate the Sim Helm chart on Kubernetes. Covers install path selection (inline / existingSecret / External Secrets Operator), required secret generation, the values.yaml mental model (env vs envDefaults vs Secret), and common failure triage. Invoke when a user asks about deploying Sim to a cluster, authoring a Sim values.yaml, debugging a Sim pod that won't start, upgrading a Sim release, or wiring Sim into a secret manager.
license: Apache-2.0
---

# Sim Helm Chart — Operations Skill

This skill helps an agent deploy and operate the **Sim** Helm chart at `helm/sim/` in the [simstudioai/sim](https://github.com/simstudioai/sim) repository. Use it when the user is installing, upgrading, troubleshooting, or authoring values for the Sim chart.

The skill is **diagnostic-first**: capture context, classify the situation, load only the references that apply, then act. Do not dump the README at the user. Do not invent values that are not in their current state.

---

## Workflow — follow in order

### 1. Capture context

Before recommending anything, ask (or infer from the conversation) all of these. **Never skip this step.** A wrong assumption here corrupts every downstream step.

| Question | Why it matters |
|---|---|
| Cluster: EKS / GKE / AKS / OpenShift / kind / other? | Storage class, ingress class, identity provider differ |
| Secret strategy: inline `--set`, pre-existing K8s Secret, or External Secrets Operator (ESO)? | The chart has three distinct code paths |
| Postgres: chart-bundled, or external (RDS / Cloud SQL / Azure DB)? | Different value blocks (`postgresql.*` vs `externalDatabase.*`) |
| Public-facing? Ingress class? TLS? | `ingress.enabled`, `ingress.className`, cert-manager wiring |
| HA? (target replicas) | Drives `autoscaling.enabled`, `app.replicaCount`, PDB activation |
| Existing values.yaml the user is editing? | Always read it before proposing a diff — never write blind |

If the user has a `values.yaml`, read it. If they don't, ask before writing one.

### 2. Diagnose

Map the user's request to one of these categories and load the matching reference(s):

| Situation | Reference |
|---|---|
| User wants to install for the first time | `references/install-paths.md` then `references/secrets.md` |
| User needs to generate the required secrets | `references/secrets.md` |
| User asks "what does this value do" / wants to author values.yaml | `references/values-model.md` |
| Pod won't start, error message, `CrashLoopBackOff`, image pull error, ingress not routing | `references/troubleshooting.md` |
| User asks about ESO / Vault / AWS Secrets Manager / Azure Key Vault / GCP Secret Manager | `references/install-paths.md` (ESO section) |
| User asks "is X production-ready" / autoscaling / network policy / security context | Read the README's "Production checklist" section directly — no separate reference |

Load **only** what the situation requires. Loading every reference burns tokens and produces vague answers.

### 3. Propose

When proposing values changes:

- Show the **minimal diff** against the user's current values.yaml. Don't rewrite the file.
- Name the **risk** (e.g., "this puts the secret in `helm get values` output — fine for dev, not for prod").
- Name the **rollback** (e.g., "if this breaks, `helm rollback sim 1` reverts").
- Cite the canonical source (`helm/sim/values.yaml` line numbers, README section, or this skill's reference file).

### 4. Validate before applying

Always run these before telling the user to `helm install` / `helm upgrade`:

```bash
# Schema + value validation
helm lint helm/sim --values <user-values>.yaml

# Render full manifest set to catch template errors
helm template sim helm/sim --values <user-values>.yaml > /tmp/render.yaml

# For upgrades, render against the live release first
helm upgrade --dry-run sim helm/sim --values <user-values>.yaml
```

If lint or template fails, fix the values — do not work around chart validation. The chart's `fail` statements exist to catch misconfigurations that would otherwise surface as `CrashLoopBackOff` at runtime.

### 5. Deliver

Every recommendation should include:

- The exact command(s) to run
- A one-line summary of what will change
- The success signal (e.g., "`kubectl rollout status deploy/sim-app` returns Ready")
- The rollback command if something breaks

---

## Quick reference — the three secret modes

| Mode | When | Code path |
|---|---|---|
| **Inline (`--set`)** | Dev / kind / dry-run only. Values leak into `helm get values`. | `app.env.<KEY>: "..."` |
| **Pre-existing Secret** | GitOps with Sealed Secrets / SOPS, or hand-managed Secrets. Chart references a Secret you create. | `app.secrets.existingSecret.enabled: true` + `.name` |
| **External Secrets Operator (recommended for prod)** | Vault, AWS SM, Azure KV, GCP SM. Chart renders an `ExternalSecret` that ESO syncs. | `externalSecrets.enabled: true` + `secretStoreRef` + `remoteRefs.app.<KEY>` |

These modes are **mutually exclusive** for the app Secret. ESO takes precedence over inline. `existingSecret` takes precedence over inline. The chart **fails template rendering** when ESO is enabled and a required key (`BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `INTERNAL_API_SECRET`, plus `CRON_SECRET` when cronjobs are enabled) is neither in `app.env` nor mapped in `remoteRefs.app` — see `references/install-paths.md`.

---

## Quick reference — the four required secrets

| Key | Generate with | Notes |
|---|---|---|
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` | Session signing |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` | App-level encryption |
| `INTERNAL_API_SECRET` | `openssl rand -hex 32` | Service-to-service auth (app ↔ realtime) |
| `CRON_SECRET` | `openssl rand -hex 32` | Required iff `cronjobs.enabled=true` (default true) |

Optional but commonly needed:

| Key | Generate with | Notes |
|---|---|---|
| `API_ENCRYPTION_KEY` | `openssl rand -hex 32` | Must be **exactly 64 hex chars**. Required to encrypt user API keys at rest. |
| `postgresql.auth.password` | `openssl rand -base64 24 \| tr -d '/+='` | Only if using chart-bundled Postgres. Must match `^[a-zA-Z0-9._-]+$` for DATABASE_URL compatibility. |

See `references/secrets.md` for storage patterns and rotation guidance.

---

## Rules of engagement

These are non-negotiable. Violating any of these has burned users in the past.

1. **Never recommend `--set` for production secrets.** They land in `helm get values` and Helm release history. Direct users to `existingSecret` or ESO.
2. **Never set `image.tag: latest`.** The chart defaults to `Chart.AppVersion` for a reason — reproducible rollouts. If the user pinned `latest`, push back.
3. **Never edit chart templates to work around a `fail` statement.** The validation exists because a misconfiguration would otherwise surface as a runtime CrashLoopBackOff with cryptic env errors.
4. **Never drop `automountServiceAccountToken: false`** unless the workload genuinely needs in-cluster API access (Sim's app/realtime/postgres pods do not).
5. **Never `kubectl delete sts` without `--cascade=orphan`** on a live Postgres. It deletes the pods and PVCs.
6. **Never tell a user "the chart works on your cluster" without `helm lint` + `helm template` against their values.** Static reading is not validation.
7. **Always confirm before `helm uninstall` in a shared namespace.** PVCs survive but other namespace resources may not.

---

## When the user is stuck and you can't diagnose

Get logs from every component in parallel. This single block answers ~80% of "it's broken" questions:

```bash
kubectl --namespace <ns> get pods,events --sort-by='.lastTimestamp'
kubectl --namespace <ns> logs deploy/sim-app --tail=200
kubectl --namespace <ns> logs deploy/sim-realtime --tail=200
kubectl --namespace <ns> logs sts/sim-postgresql --tail=200
kubectl --namespace <ns> logs job/sim-migrations --tail=200 2>/dev/null
kubectl --namespace <ns> describe pod -l app.kubernetes.io/name=sim
```

Then map the symptom to `references/troubleshooting.md`.

---

## What this skill does **not** cover

- Sim application configuration beyond env vars (provider keys, knowledge base setup, etc.) — that's the Sim app docs at https://docs.sim.ai
- Kubernetes cluster setup (creating an EKS cluster, installing ingress-nginx, etc.) — that's cloud-provider docs
- Authoring new chart templates — that's `helm/sim/templates/_helpers.tpl` and the chart's own contributor docs
- Running Sim outside Kubernetes (Docker Compose, bare-metal) — see the root `README.md`

If the user's question falls outside this scope, say so and point them at the right doc.
