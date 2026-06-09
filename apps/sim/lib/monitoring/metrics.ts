/**
 * Hosted-key metrics → CloudWatch.
 *
 * Emitted to CloudWatch (not OTel/Prometheus) because hosted-key work runs in
 * both the long-lived web app and ephemeral trigger.dev workers. CloudWatch
 * aggregates pushed values server-side (additively), so one-shot worker
 * processes don't break aggregation the way cumulative Prometheus counters do
 * (no per-process series collisions, no counter-reset math, no delta plumbing).
 *
 * Dimensions stay low-cardinality (Provider, Tool, Key, Reason, Environment) —
 * CloudWatch bills per unique dimension combination. `Key` is the env-var NAME
 * of the chosen hosted key (e.g. `PERPLEXITY_API_KEY_2`), never the secret.
 * Per-workspace/user cost lives in the `usage_log` table, never on a dimension.
 *
 * Records buffer in-process and flush asynchronously via PutMetricData (batched,
 * off the request path). Long-lived processes flush on a timer + SIGTERM;
 * call flushHostedKeyMetrics() at the end of an ephemeral run so a worker that
 * exits between flushes doesn't drop its last batch.
 */

import {
  CloudWatchClient,
  type MetricDatum,
  PutMetricDataCommand,
  StandardUnit,
} from '@aws-sdk/client-cloudwatch'
import { createLogger } from '@sim/logger'

const logger = createLogger('HostedKeyMetrics')

const NAMESPACE = 'Sim/HostedKey'
const MAX_BATCH = 1000 // CloudWatch PutMetricData hard limit per request
const FLUSH_INTERVAL_MS = 5_000
const MAX_BUFFER = 1000

type ThrottleReason = 'billing_actor_limit' | 'upstream_retries_exhausted'
type QueueReason = 'actor_requests' | 'dimension' | 'queue_position'
type FailureReason = 'rate_limited' | 'auth' | 'other'

// Deployed envs (app + trigger worker) carry static AWS creds; local dev does
// not. No creds → no-op, so recorders stay always-safe to call (same contract
// as the previous no-op-meter behavior).
const ENABLED = Boolean(process.env.AWS_ACCESS_KEY_ID)

const ENVIRONMENT =
  process.env.OTEL_DEPLOYMENT_ENVIRONMENT ||
  process.env.DEPLOYMENT_ENVIRONMENT ||
  process.env.NODE_ENV ||
  'development'

let client: CloudWatchClient | undefined
let buffer: MetricDatum[] = []
let timer: ReturnType<typeof setInterval> | undefined
let handlersRegistered = false

function getClient(): CloudWatchClient {
  if (!client) {
    client = new CloudWatchClient({ region: process.env.AWS_REGION || 'us-east-1' })
  }
  return client
}

function ensureBackground(): void {
  if (timer) return
  timer = setInterval(() => {
    void flushHostedKeyMetrics()
  }, FLUSH_INTERVAL_MS)
  timer.unref?.()
  if (!handlersRegistered) {
    handlersRegistered = true
    const onExit = () => {
      void flushHostedKeyMetrics()
    }
    process.once('SIGTERM', onExit)
    process.once('SIGINT', onExit)
    process.once('beforeExit', onExit)
  }
}

function buildDimensions(labels: Record<string, string | undefined>) {
  const dimensions = [{ Name: 'Environment', Value: ENVIRONMENT }]
  for (const [Name, Value] of Object.entries(labels)) {
    if (Value) dimensions.push({ Name, Value })
  }
  return dimensions
}

function enqueue(
  MetricName: string,
  Value: number,
  Unit: StandardUnit,
  labels: Record<string, string | undefined>
): void {
  if (!ENABLED) return
  buffer.push({
    MetricName,
    Value,
    Unit,
    Timestamp: new Date(),
    Dimensions: buildDimensions(labels),
  })
  ensureBackground()
  if (buffer.length >= MAX_BUFFER) void flushHostedKeyMetrics()
}

/** Drain the buffer to CloudWatch. Safe to call repeatedly; await before exit. */
export async function flushHostedKeyMetrics(): Promise<void> {
  if (!ENABLED || buffer.length === 0) return
  const pending = buffer
  buffer = []
  for (let i = 0; i < pending.length; i += MAX_BATCH) {
    const MetricData = pending.slice(i, i + MAX_BATCH)
    try {
      await getClient().send(new PutMetricDataCommand({ Namespace: NAMESPACE, MetricData }))
    } catch (err) {
      // Telemetry must never break the request path — log and drop the batch.
      logger.warn('PutMetricData failed; dropping batch', {
        count: MetricData.length,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
}

export const hostedKeyMetrics = {
  recordUsed(labels: { provider: string; tool: string; key: string }) {
    enqueue('Used', 1, StandardUnit.Count, {
      Provider: labels.provider,
      Tool: labels.tool,
      Key: labels.key,
    })
  },
  recordFailed(labels: { provider: string; tool: string; key: string; reason: FailureReason }) {
    enqueue('Failed', 1, StandardUnit.Count, {
      Provider: labels.provider,
      Tool: labels.tool,
      Key: labels.key,
      Reason: labels.reason,
    })
  },
  recordCostCharged(costUsd: number, labels: { provider: string; tool: string }) {
    // Unit None: CloudWatch has no USD unit; value is dollars.
    if (costUsd > 0)
      enqueue('CostCharged', costUsd, StandardUnit.None, {
        Provider: labels.provider,
        Tool: labels.tool,
      })
  },
  recordThrottled(labels: { provider: string; tool: string; reason: ThrottleReason }) {
    enqueue('Throttled', 1, StandardUnit.Count, {
      Provider: labels.provider,
      Tool: labels.tool,
      Reason: labels.reason,
    })
  },
  recordUpstreamRateLimited(labels: { tool: string; key: string }) {
    enqueue('UpstreamRateLimited', 1, StandardUnit.Count, {
      Tool: labels.tool,
      Key: labels.key,
    })
  },
  recordQueueWait(durationMs: number, labels: { provider: string; reason: QueueReason }) {
    enqueue('QueueWaitDuration', durationMs, StandardUnit.Milliseconds, {
      Provider: labels.provider,
      Reason: labels.reason,
    })
  },
  recordQueueWaitExceeded(labels: { provider: string; reason: QueueReason }) {
    enqueue('QueueWaitExceeded', 1, StandardUnit.Count, {
      Provider: labels.provider,
      Reason: labels.reason,
    })
  },
  recordUnknownModelCost(labels: { tool: string }) {
    enqueue('UnknownModelCost', 1, StandardUnit.Count, { Tool: labels.tool })
  },
}
