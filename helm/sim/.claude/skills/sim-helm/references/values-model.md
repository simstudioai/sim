# The values.yaml Mental Model

The Sim chart splits configuration across **four** layers. Understanding which layer owns which key is the difference between a working install and a five-hour debugging session.

## The four layers

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Layer 1: app.env / realtime.env                                            │
│   → Written to a chart-managed Kubernetes Secret                           │
│   → Mounted on pods via envFrom: secretRef                                 │
│   → Use for: anything sensitive OR anything that varies per-environment   │
│   → Examples: BETTER_AUTH_SECRET, NEXT_PUBLIC_APP_URL, OPENAI_API_KEY     │
└───────────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ env: (inline) overrides envFrom (Secret)
                                  ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ Layer 2: app.envDefaults / realtime.envDefaults                            │
│   → Rendered as inline env: on the Deployment                              │
│   → SKIPPED for any key already set in app.env (or realtime.env)          │
│   → Use for: operational tunables and safe fallback defaults              │
│   → Examples: NODE_ENV=production, RATE_LIMIT_*, IVM_*, brand defaults    │
└───────────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ chart-computed values are always inline
                                  ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ Layer 3: chart-computed (inline env: on the Deployment)                    │
│   → DATABASE_URL, SOCKET_SERVER_URL, OLLAMA_URL                           │
│   → Derived from postgresql.* / externalDatabase.* / service.* values     │
│   → CANNOT be overridden via app.env — chart filters them out             │
└───────────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ extraEnvVars appends at the end
                                  ▼
┌───────────────────────────────────────────────────────────────────────────┐
│ Layer 4: extraEnvVars (escape hatch)                                       │
│   → Raw env: list appended after everything else                          │
│   → Use for: things the chart doesn't model (valueFrom: configMapKeyRef,  │
│              custom fieldRef, downward API)                                │
└───────────────────────────────────────────────────────────────────────────┘
```

## Why this layering exists

**ESO compatibility.** When `externalSecrets.enabled=true`, the chart-managed Secret is **not rendered** — ESO renders one instead. Anything in Layer 1 must be mapped via `remoteRefs.app.<KEY>` or it's silently missing. Layers 2–4 are unaffected by ESO.

**Override precedence.** Values set in `app.env` (Layer 1 overrides) win over `envDefaults` (Layer 2) — so users who already had operational tunables in `app.env` continue to work.

## Where keys live — the canonical list

The exhaustive list of keys per layer lives in `helm/sim/values.yaml`. Read the file directly when you need to know "is X a Secret key or a tunable?" — it's grouped by layer with comments.

| Concern | Layer | Example keys |
|---|---|---|
| Auth secrets | 1 (app.env) | `BETTER_AUTH_SECRET`, `ENCRYPTION_KEY`, `INTERNAL_API_SECRET`, `CRON_SECRET`, `API_ENCRYPTION_KEY` |
| Provider API keys | 1 (app.env) | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_SECRET`, etc. |
| Per-environment URLs | 1 (app.env) | `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL`, `NEXT_PUBLIC_SOCKET_URL` |
| Feature flags | 1 (app.env) | `ACCESS_CONTROL_ENABLED`, `ORGANIZATIONS_ENABLED`, `SSO_ENABLED`, all `NEXT_PUBLIC_*_ENABLED` |
| Brand / whitelabel | 1 (app.env) | `NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_BRAND_LOGO_URL`, etc. |
| Operational defaults | 2 (envDefaults) | `NODE_ENV=production`, `EMAIL_VERIFICATION_ENABLED=false`, `VERTEX_LOCATION=us-central1`, `NEXT_PUBLIC_SUPPORT_EMAIL=help@sim.ai` |
| Rate limits | 2 (envDefaults) | `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_FREE_SYNC`, etc. |
| Execution timeouts | 2 (envDefaults) | `EXECUTION_TIMEOUT_FREE`, `EXECUTION_TIMEOUT_PRO`, etc. |
| IVM pool / quotas | 2 (envDefaults) | `IVM_POOL_SIZE`, `IVM_MAX_CONCURRENT`, `IVM_MAX_PER_WORKER`, etc. |
| Connection strings | 3 (chart-computed) | `DATABASE_URL`, `SOCKET_SERVER_URL`, `OLLAMA_URL` |
| Custom downward API / configMapKeyRef | 4 (extraEnvVars) | anything that needs `valueFrom:` |

## Common authoring patterns

### "I want to set OPENAI_API_KEY for the app"

```yaml
app:
  env:
    OPENAI_API_KEY: "sk-..."  # ends up in the app Secret, mounted via envFrom
```

For ESO:

```yaml
externalSecrets:
  remoteRefs:
    app:
      OPENAI_API_KEY: sim/providers/openai-api-key
```

### "I want to bump the rate limit"

```yaml
app:
  envDefaults:
    RATE_LIMIT_FREE_SYNC: "100"   # overrides the chart's default of 50
```

Or override it as a regular env var (also valid — Layer 1 wins over Layer 2):

```yaml
app:
  env:
    RATE_LIMIT_FREE_SYNC: "100"
```

Prefer Layer 2 for non-sensitive tunables — keeps the Secret lean and ESO mapping minimal.

### "I want to set my production app URL"

```yaml
app:
  env:
    NEXT_PUBLIC_APP_URL: "https://sim.example.com"
    BETTER_AUTH_URL: "https://sim.example.com"
```

This is the right answer for any clustered deploy. The chart's default is `http://localhost:3000` (Layer 2) — fine for kind/minikube, broken for production. The realtime Deployment also reads these via the shared Secret.

### "I want to inject a value from another ConfigMap"

Use Layer 4:

```yaml
extraEnvVars:
  - name: SOME_VALUE
    valueFrom:
      configMapKeyRef:
        name: my-config
        key: some-key
```

### "I want to change DATABASE_URL"

You can't override it directly — it's Layer 3, chart-computed. Set the inputs instead:

- For chart-bundled Postgres: edit `postgresql.auth.username`, `.database`, `.port`
- For external Postgres: enable `externalDatabase.enabled=true` and set `host`, `port`, `username`, `database`, `sslMode`

The chart will compose `DATABASE_URL` from those values.

## Override precedence — the actual K8s rule

When a key exists in both inline `env:` and `envFrom:`:

```
container.env (Layer 2, 3, 4) WINS over container.envFrom (Layer 1)
```

This is the Kubernetes spec, not a chart quirk. It's the reason for the override-skip logic in Layer 2: if you set `NEXT_PUBLIC_APP_URL` in Layer 1 (the Secret), the chart **must not** inline the same key in Layer 2 — otherwise the localhost default would mask your prod URL on the realtime pod (which mounts the same shared Secret as the app pod).

The chart handles this correctly for both `app` and `realtime` Deployments. If you ever see a stale value on a pod, check whether the same key is set in **both** `app.env` and `realtime.env` — the merge order in `secrets-app.yaml` makes `app.env` authoritative for shared keys.
