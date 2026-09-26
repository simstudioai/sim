# On-prem usage telemetry

Reports a self-hosted deployment's daily usage to a Sim instance, where it is
valued at a per-deployment credit → dollar rate and read through the admin API.
Operator documentation: `apps/docs/content/docs/platform/self-hosting/usage-telemetry.mdx`.

## Shape

```
usage_log + workflow_execution_logs        (already written on every deployment)
        │  aggregate query, grouped by UTC day — no per-row data leaves Postgres
        ▼
lib/onprem-telemetry/collect.ts            buckets: one per day, counts + sums only
        │  POST, bearer = deployment API key, trailing N days every run
        ▼  (app/api/cron/onprem-usage-report — the feature's only entry point)
POST /api/onprem-telemetry/report          upsert on (deployment_id, period_start)
        ▼
onprem_usage_report                         credits stored; dollars derived at read
        ▼
GET /api/v1/admin/onprem-telemetry/…        rows carry credits + applied rate + usd
```

Both halves live in this codebase: a self-hosted deployment is the sender, and
whichever Sim instance owns the admin API is the receiver.

## Decisions

**Read the ledger; do not add instrumentation.** `recordUsage` already writes
`usage_log` on every deployment regardless of `BILLING_ENABLED` — its own
comment calls the ledger "the single, universal source of truth for cost
(including self-hosted)". Workflow counts, status and duration are likewise
already in `workflow_execution_logs`. So the collector is a reader, not a new
write path, and nothing about how a workflow runs changed.

**Separate from `lib/core/telemetry.ts` on purpose.** That pipeline is
fire-and-forget by design (`trackPlatformEvent` swallows errors; the
`/api/telemetry` route forwards with a 5 s abort and no retry). That is right
for product analytics and wrong for figures with a dollar value attached. This
system re-sends a trailing window on every run and the receiver upserts, so a
day is delivered at least once and converges without an outbox or local state.

**Aggregate in SQL.** The two queries `GROUP BY` day (and source/category, or
model) and return counts and sums. Per-execution rows, identifiers, inputs,
outputs and tool names never reach the reporting code, so the privacy
requirement holds by construction rather than by a filter someone must
remember to maintain. `description` is kept only where it names a model.

**Off the execution path, structurally.** The only caller of the reporter is
the cron endpoint. Disabled means `getOnPremTelemetryConfig()` returns before
any query or `fetch` — the first statement of the run, covered by a test that
asserts `fetch` is never called. A reachable-but-failing receiver yields a
`failed` result and a log line; nothing throws into anything a workflow
depends on.

**Credits are the fact; dollars are derived.** The receiver stores `credits`
per day and an append-only, effective-dated rate table. `valueUsage` joins each
day to the rate whose `effectiveFrom` most recently precedes `periodStart`.
That makes rate-change semantics a one-line rule (see `rates.ts`): a new rate
applies from its `effectiveFrom` forward; a backdated rate re-values the days it
now covers on the next read; no stored credit ever changes; days before the
first rate report `usd: null` and are summed as `unvaluedCredits` instead of
being priced silently. Rates live on the receiver, not the deployment, so they
are commercial terms the customer cannot edit and changing one needs no
redeploy.

**Why a per-deployment rate exists at all.** Cloud enterprise contracts already
convert dollars to credits at a negotiated figure (`enterprise-credit-limits.ts`
overrides `dollarsToCredits` via `usageLimitCredits`). This is the same idea for
deployments Sim cannot instrument directly. The rate is deliberately a third
concept next to `CREDIT_MULTIPLIER` (the fixed 200 credits/dollar used to
compute `credits` from ledger dollars) and `COST_MULTIPLIER` (an execution-time
cost scaler); neither is reused.

**Why credits on a self-hosted deployment are mostly the run charge.** Models
there run on the customer's own keys, so the ledger records them as
`model_unbilled` with cost 0 and tokens in metadata (the same path a BYOK user
takes on cloud — it is a key-ownership branch, not a deployment branch).
`BASE_EXECUTION_CHARGE` is ungated, so every run contributes exactly one credit.
Token volume per model is reported next to credits so the receiver can see the
model usage Sim never billed, which the brief asks for explicitly. Pricing BYOK
tokens is left to the receiver (it holds the price book) and is not done here.

**Minimal surface.** Three tables, one wire contract shared by sender and
receiver (`lib/api/contracts/onprem-telemetry.ts`, schema-versioned), one cron
route, one ingest route, three admin routes. No new pool profile (the aggregate
holds no transaction), no Redis lock (upserts make overlapping runs safe), no
outbox (re-sending the window is the retry).

## Limitations

- **Cooperative, not enforced.** Nothing here proves a deployment reported
  completely; the customer controls the database and the flag. Enforcement
  would need attestation or a license mechanism, which does not exist in this
  codebase and is out of scope.
- **Copilot chat usage is absent on-prem.** `POST /api/billing/update-cost`
  returns `200 "Billing disabled, cost update skipped"` when `BILLING_ENABLED`
  is unset, so chat model cost never reaches `usage_log` there; the four
  Sim-Chat-family sources will read as zero. Recording those callbacks
  unconditionally would close the gap and is the natural follow-up.
- **Ledger scan.** `usage_log` has no index led by `created_at`; the collector's
  window scan is a sequential scan on a large ledger. The job runs every six
  hours to keep that cheap. A concurrent index on `usage_log (created_at)` is
  the fix if a deployment's ledger grows large; it was not added here to avoid
  an index build on Sim Cloud's own ledger as a side effect.
- **Day granularity, UTC.** A day is partial until the first run after UTC
  midnight (`reportedAt` says when it was last sent). Rate changes apply at day
  boundaries — a rate effective mid-day covers that whole day if it precedes
  the day's start, otherwise starts the next day.
- **No audit rows** for deployment or rate creation. The admin API key is the
  only actor, as with other admin endpoints; adding `AuditAction` values was
  left out to keep the change small.
