# Upgrading from a pre-1.0.0 Sim chart build

If the user installed the chart from a git checkout **before** the `1.0.0` tag, `helm upgrade` will fail with:

```
Error: UPGRADE FAILED: cannot patch "<release>-postgresql" with kind StatefulSet:
StatefulSet.apps "<release>-postgresql" is invalid:
spec: Forbidden: updates to statefulset spec for fields other than
'replicas', 'ordinals', 'template', 'updateStrategy',
'persistentVolumeClaimRetentionPolicy' and 'minReadySeconds' are forbidden
```

This is the most painful upgrade path in the chart. Walk the user through it carefully.

## Why

In 1.0.0 the internal Postgres `StatefulSet.spec.serviceName` was renamed to point at a new headless Service. Kubernetes forbids changes to `serviceName` after the StatefulSet exists. The fix is a one-time orphan-delete that preserves the pods and PVCs (no data loss, no downtime for in-flight queries), then re-runs `helm upgrade` to create a new StatefulSet pointing at the new headless Service.

## Procedure

**1. Confirm the user is actually hitting this.** Look for `serviceName` in the error message. If they're not, this isn't the right doc — go back to `troubleshooting.md`.

**2. Identify which StatefulSets to orphan-delete.**

```bash
kubectl get sts -n <ns> -o name
```

Always: `<release>-postgresql`. Also `<release>-copilot-postgresql` if `copilot.enabled=true`.

**3. Orphan-delete each affected StatefulSet.** `--cascade=orphan` is the critical flag — without it, you delete the pods and PVCs too.

```bash
NS=sim           # adjust
RELEASE=sim      # adjust

kubectl delete statefulset $RELEASE-postgresql --namespace $NS --cascade=orphan

# Only if copilot is enabled:
kubectl delete statefulset $RELEASE-copilot-postgresql --namespace $NS --cascade=orphan
```

Verify the pods are still running:

```bash
kubectl get pods -n $NS -l app.kubernetes.io/name=postgresql
# Should still show `<release>-postgresql-0   1/1   Running`
```

And the PVCs are still there:

```bash
kubectl get pvc -n $NS
# Should still show data-<release>-postgresql-0 with status Bound
```

**4. Re-run `helm upgrade`.**

```bash
helm upgrade $RELEASE ./helm/sim --namespace $NS --values my-values.yaml
```

This creates a new StatefulSet pointing at the new headless Service. Because the pod's label selectors still match, the new StatefulSet **adopts** the existing pod — no restart, no data loss.

**5. Verify.**

```bash
kubectl rollout status sts/$RELEASE-postgresql -n $NS
kubectl get pod -n $NS -l app.kubernetes.io/name=postgresql -o yaml | grep ownerReferences -A5
# Should show the new StatefulSet as owner
```

## Other 1.0.0 breaking changes

Mention these proactively when the user is upgrading — they may not have noticed any of them yet:

| Change | What to do |
|---|---|
| Image tags default to `Chart.AppVersion` instead of `latest` | Pin `image.tag` only if you intentionally want a specific build. The new default produces reproducible rollouts. |
| `image.pullPolicy` defaults to `IfNotPresent` (was `Always`) | If you relied on `Always` to pick up retagged images, you'll need to bump the tag or explicitly set `image.pullPolicy: Always`. |
| Ollama mount moved from `/root/.ollama` to `/data` | Models must be re-pulled. If you had a large model cache on the old path, copy it to the new PVC before deleting the old one. |
| `networkPolicy.egress` is now `{exceptCidrs, extraRules}` instead of a list | Migrate any custom egress rules into the new structure. |
| `automountServiceAccountToken: false` on every pod | If you had custom workloads talking to the K8s API from inside Sim pods, you'll need to opt them back in. |
| All `app.env` / `realtime.env` keys are now written to a chart-managed Secret instead of inlined on the Deployment | No action needed if you used `--set` or values.yaml. ESO users must map every key they set in `app.env` via `externalSecrets.remoteRefs.app.<KEY>` — the chart will fail template rendering if any required key is missing. |

## If the orphan-delete went wrong

If you ran `kubectl delete sts` **without** `--cascade=orphan`, the pods and PVCs were deleted with the StatefulSet. Restore from your most recent Postgres backup:

```bash
# 1. Find the PVC backup or volume snapshot from before the delete
# 2. Recreate the PVC pointing at the snapshot
# 3. Re-run helm upgrade
# 4. Postgres pod will mount the restored PVC
```

If there's no backup, the data is gone. This is why backups exist — confirm the user has one before any destructive Postgres operation.

## Helm rollback won't fix this

`helm rollback` cannot reverse an immutable-field error. The bad release is already recorded; rollback would try to re-apply the prior StatefulSet spec, which would conflict with the new headless Service. Always do the orphan-delete instead.
