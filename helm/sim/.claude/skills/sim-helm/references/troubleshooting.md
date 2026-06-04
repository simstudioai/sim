# Troubleshooting

Map symptom → root cause → fix. Always run the diagnostic block first, then match.

## Diagnostic block (run this first)

```bash
NS=sim  # adjust to your namespace
kubectl --namespace $NS get pods,events --sort-by='.lastTimestamp'
kubectl --namespace $NS describe pod -l app.kubernetes.io/instance=sim
kubectl --namespace $NS logs deploy/sim-app --tail=200
kubectl --namespace $NS logs deploy/sim-realtime --tail=200
kubectl --namespace $NS logs sts/sim-postgresql --tail=200
kubectl --namespace $NS logs job/sim-migrations --tail=200 2>/dev/null || true
```

---

## `Error: execution error at (sim/templates/...): app.env.BETTER_AUTH_SECRET is required for production deployment`

**Cause:** `helm install` / `helm upgrade` ran without the required secrets set.

**Fix:** Generate and pass the four required secrets (see `references/secrets.md`). For production, switch to `existingSecret` or ESO instead of `--set` (see `references/install-paths.md`).

---

## `Error: execution error ...: Required key 'X' is missing: externalSecrets.enabled=true but the key is neither set in app.env nor mapped in externalSecrets.remoteRefs.app`

**Cause:** ESO is enabled but one of the required keys (`BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `INTERNAL_API_SECRET`, or `CRON_SECRET` when cronjobs are enabled) isn't mapped via `remoteRefs.app`. The chart fails fast at template time to avoid CrashLoopBackOff later.

**Fix:** Add the mapping:

```yaml
externalSecrets:
  remoteRefs:
    app:
      <KEY>: path/in/your/secret/store
```

Or, if you really don't need cronjobs, set `cronjobs.enabled=false` to drop the `CRON_SECRET` requirement.

---

## `Error: execution error ...: Key 'X' is set in app.env but externalSecrets.enabled=true and externalSecrets.remoteRefs.app.X is not configured`

**Cause:** ESO is enabled. The chart-managed Secret is not rendered. A key set in `app.env` would be silently dropped — pods would start with the wrong (missing) value.

**Fix:** Either map the key via `remoteRefs.app.X` so ESO syncs it, OR remove the key from `app.env` if you don't need it.

---

## App pods stuck in `CrashLoopBackOff`

Get the logs first:

```bash
kubectl logs --namespace sim deploy/sim-app --tail 200
```

Match the error:

| Log line | Cause | Fix |
|---|---|---|
| `Invalid env: ... NEXT_PUBLIC_APP_URL: Invalid url` | URL field set to empty string or invalid format | Set `app.env.NEXT_PUBLIC_APP_URL` to a valid URL — `https://sim.example.com` in prod, `http://localhost:3000` in dev |
| `getaddrinfo ENOTFOUND ... -postgresql` / `connect ECONNREFUSED` | App can't reach Postgres | Check `kubectl get pod -l app.kubernetes.io/name=postgresql` is `Running`; check `postgresql.auth.password` matches the password in the Secret |
| `password authentication failed for user "sim"` | Postgres password rotated but app pod wasn't restarted, OR password contains URL-unsafe chars | `kubectl rollout restart deploy/sim-app -n sim`; regenerate password with `openssl rand -base64 24 \| tr -d '/+='` |
| `BETTER_AUTH_SECRET is missing` / `INTERNAL_API_SECRET is required` | Required env var not present in the Secret | Verify with `kubectl get secret sim-app-secrets -o jsonpath='{.data}' \| jq 'keys'`; if missing, fix your secret strategy |
| `Migration failed` or app starts before migration | Migration Job hasn't completed | `kubectl logs job/sim-migrations -n sim`; rerun with `kubectl delete job/sim-migrations && helm upgrade ...` |

---

## Image pull errors (`ErrImagePull` / `ImagePullBackOff`)

```bash
kubectl describe pod -l app.kubernetes.io/name=sim -n sim | grep -A5 "Failed\|Warning"
```

| Cause | Fix |
|---|---|
| Private registry, no pull secret | Set `global.imagePullSecrets: [{name: my-regcred}]` and create the regcred Secret: `kubectl create secret docker-registry my-regcred --docker-server=... --docker-username=... --docker-password=...` |
| Image tag doesn't exist in the registry | `helm get values sim`, check the rendered `image.tag`; correct it or fall back to `Chart.AppVersion` |
| Air-gapped cluster | Mirror the image to your internal registry, set `global.imageRegistry=my-registry.example.com` |

---

## Postgres pod `Pending`

```bash
kubectl describe pvc --namespace sim
```

Always one of:

| `Events` says | Cause | Fix |
|---|---|---|
| `no persistent volumes available for this claim and no storage class is set` | No default StorageClass | Set `global.storageClass: <your-class>` or annotate one as default |
| `Failed to provision volume with StorageClass "X"` | No PV provisioner installed | Install one (`local-path-provisioner` for kind, EBS CSI for EKS, PD CSI for GKE, Azure Disk CSI for AKS) |
| `only ReadWriteOnce access modes are supported` | StorageClass doesn't support RWO | Pick a different `global.storageClass` |
| `pod has unbound immediate PersistentVolumeClaims` and no events | StorageClass uses `WaitForFirstConsumer` and pod isn't schedulable | Check pod's `nodeSelector` / `tolerations` against your nodes |

---

## Ingress not routing

```bash
kubectl get ingress -n sim
kubectl describe ingress -n sim
```

| Cause | Fix |
|---|---|
| No `ADDRESS` in `kubectl get ingress` | Ingress controller not installed — install `ingress-nginx`, AWS LBC, GCP LB controller, etc. |
| `ingressClassName` doesn't match installed controller | `kubectl get ingressclass` to list installed classes, set `ingress.className` to match |
| Address is set but DNS resolves to wrong IP | `dig <your-host>` — point DNS at the ingress controller's external IP / LoadBalancer / CNAME |
| TLS cert errors | If using cert-manager, check `kubectl describe certificate -n sim`; verify `ingress.tls.issuerRef` |
| `503 Service Unavailable` | Ingress routing is fine but app pod isn't `Ready` — go back to the diagnostic block |

---

## CronJob pods fail with `CreateContainerConfigError: couldn't find key CRON_SECRET in Secret`

**Cause:** `cronjobs.enabled=true` (the default) but `CRON_SECRET` isn't in the app Secret. Two paths:

1. Inline mode: `app.env.CRON_SECRET=""` — the chart will fail at template time. If you somehow got past that, regenerate and set it.
2. Existing-Secret mode: your pre-created Secret doesn't include `CRON_SECRET`. Add it:
   ```bash
   kubectl patch secret sim-app-secrets -n sim --type='json' \
     -p='[{"op":"add","path":"/data/CRON_SECRET","value":"'$(openssl rand -hex 32 | base64)'"}]'
   ```
3. ESO mode: missing `remoteRefs.app.CRON_SECRET` mapping. Add it.

Or set `cronjobs.enabled=false` if you don't need scheduled jobs.

---

## `app.kubernetes.io/managed-by: Helm` collisions when upgrading

You installed once with `--name foo`, then tried to install again with `--name bar` into the same namespace. Resources collide on labels.

**Fix:** Use distinct namespaces per release, or `helm uninstall foo -n <ns>` first.

---

## Pods get OOMKilled

```bash
kubectl get events -n sim --field-selector reason=OOMKilling
```

Bump the relevant resource limit. Defaults:

| Workload | Default request | Default limit |
|---|---|---|
| `app` | `1000m` CPU / `4Gi` memory | `2000m` CPU / `8Gi` memory |
| `realtime` | `250m` CPU / `512Mi` memory | `500m` CPU / `1Gi` memory |
| `postgresql` | `250m` CPU / `512Mi` memory | `1000m` CPU / `2Gi` memory |

Override in values:

```yaml
app:
  resources:
    requests:
      memory: 8Gi
    limits:
      memory: 16Gi
```

---

## Logs to grab when filing a support issue

```bash
helm version
kubectl version --short
helm get values sim -n sim --revision $(helm history sim -n sim | tail -1 | awk '{print $1}')
kubectl get all,pvc,ingress,externalsecret -n sim -o wide
kubectl describe pods -n sim -l app.kubernetes.io/instance=sim | head -200
kubectl logs --tail=500 -n sim deploy/sim-app
kubectl logs --tail=500 -n sim deploy/sim-realtime
```

Redact any secrets before sharing.
