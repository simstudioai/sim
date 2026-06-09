/**
 * Application metrics → CloudWatch.
 *
 * Emitted to CloudWatch (not OTel/Prometheus) because this work runs in both
 * the long-lived web app and ephemeral trigger.dev workers. CloudWatch
 * aggregates pushed values server-side (additively), so one-shot worker
 * processes don't break aggregation the way cumulative Prometheus counters do
 * (no per-process series collisions, no counter-reset math, no delta plumbing).
 *
 * Dimensions stay low-cardinality — CloudWatch bills per unique dimension
 * combination. Hosted-key metrics use Provider/Tool/Key/Reason; workflow
 * metrics use Trigger/Status/BlockType/Operation. `Key` is the env-var NAME
 * of the chosen hosted key (e.g. `PERPLEXITY_API_KEY_2`), never the secret.
 * Per-workspace/user breakdowns live in the database, never on a dimension.
 *
 * Records buffer in-process and flush asynchronously via PutMetricData (batched
 * per namespace, off the request path). Flushing is automatic — a 5s timer, a
 * buffer-size threshold, and SIGTERM/SIGINT/beforeExit (the exit handlers AWAIT
 * the final drain, so both long-lived app processes and ephemeral trigger.dev
 * workers push their last batch before the process exits). flushMetrics() is
 * also exported for explicit/early draining (e.g. tests). The buffer is
 * hard-capped: if CloudWatch flushing stalls it drops the oldest points rather
 * than growing unbounded.
 */

import {
  CloudWatchClient,
  type MetricDatum,
  PutMetricDataCommand,
  StandardUnit,
} from '@aws-sdk/client-cloudwatch'
import { createLogger } from '@sim/logger'

const logger = createLogger('CloudWatchMetrics')

const HOSTED_KEY_NAMESPACE = 'Sim/HostedKey'
const WORKFLOW_NAMESPACE = 'Sim/Workflow'
const MAX_BATCH = 1000 // CloudWatch PutMetricData hard limit per request
const FLUSH_INTERVAL_MS = 5_000
const FLUSH_THRESHOLD = 1000 // flush once the buffer reaches this many points
const MAX_BUFFER = 10_000 // hard cap; drop oldest beyond this if flushing stalls

type ThrottleReason = 'billing_actor_limit' | 'upstream_retries_exhausted'
type QueueReason = 'actor_requests' | 'dimension' | 'queue_position'
type FailureReason = 'rate_limited' | 'auth' | 'other'

export type WorkflowExecutionStatus = 'success' | 'failed' | 'cancelled'

// Deployed envs (app + trigger worker) carry static AWS creds; local dev does
// not. No creds → no-op, so recorders stay always-safe to call (same contract
// as the previous no-op-meter behavior).
const ENABLED = Boolean(process.env.AWS_ACCESS_KEY_ID)

// GRAFANA_DEPLOYMENT_ENVIRONMENT is the per-environment label already set for
// trigger.dev telemetry — without it (or one of the OTEL_/DEPLOYMENT_ vars),
// the NODE_ENV fallback collapses staging into 'production' since staging
// builds also run with NODE_ENV=production.
const ENVIRONMENT =
  process.env.OTEL_DEPLOYMENT_ENVIRONMENT ||
  process.env.DEPLOYMENT_ENVIRONMENT ||
  process.env.GRAFANA_DEPLOYMENT_ENVIRONMENT ||
  process.env.NODE_ENV ||
  'development'

interface BufferedDatum {
  namespace: string
  datum: MetricDatum
}

let client: CloudWatchClient | undefined
let buffer: BufferedDatum[] = []
let dropped = 0
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
    void flushMetrics()
  }, FLUSH_INTERVAL_MS)
  timer.unref?.()
  if (!handlersRegistered) {
    handlersRegistered = true
    const onExit = async () => {
      await flushMetrics()
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
  namespace: string,
  MetricName: string,
  Value: number,
  Unit: StandardUnit,
  labels: Record<string, string | undefined>
): void {
  if (!ENABLED) return
  buffer.push({
    namespace,
    datum: {
      MetricName,
      Value,
      Unit,
      Timestamp: new Date(),
      Dimensions: buildDimensions(labels),
    },
  })
  if (buffer.length > MAX_BUFFER) {
    // Flushing has stalled (CloudWatch slow/erroring) — bound memory by dropping
    // the oldest points instead of growing without limit.
    const overflow = buffer.length - MAX_BUFFER
    buffer.splice(0, overflow)
    dropped += overflow
  }
  ensureBackground()
  if (buffer.length >= FLUSH_THRESHOLD) void flushMetrics()
}

/** Drain the buffer to CloudWatch. Safe to call repeatedly; await before exit. */
export async function flushMetrics(): Promise<void> {
  if (dropped > 0) {
    logger.warn('Dropped metric points (buffer cap reached)', { dropped })
    dropped = 0
  }
  if (!ENABLED || buffer.length === 0) return
  const pending = buffer
  buffer = []
  const byNamespace = new Map<string, MetricDatum[]>()
  for (const { namespace, datum } of pending) {
    const data = byNamespace.get(namespace)
    if (data) data.push(datum)
    else byNamespace.set(namespace, [datum])
  }
  for (const [Namespace, data] of byNamespace) {
    for (let i = 0; i < data.length; i += MAX_BATCH) {
      const MetricData = data.slice(i, i + MAX_BATCH)
      try {
        await getClient().send(new PutMetricDataCommand({ Namespace, MetricData }))
      } catch (err) {
        // Telemetry must never break the request path — log and drop the batch.
        logger.warn('PutMetricData failed; dropping batch', {
          namespace: Namespace,
          count: MetricData.length,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }
}

export const hostedKeyMetrics = {
  recordUsed(labels: { provider: string; tool: string; key: string }) {
    enqueue(HOSTED_KEY_NAMESPACE, 'Used', 1, StandardUnit.Count, {
      Provider: labels.provider,
      Tool: labels.tool,
      Key: labels.key,
    })
  },
  recordFailed(labels: { provider: string; tool: string; key: string; reason: FailureReason }) {
    enqueue(HOSTED_KEY_NAMESPACE, 'Failed', 1, StandardUnit.Count, {
      Provider: labels.provider,
      Tool: labels.tool,
      Key: labels.key,
      Reason: labels.reason,
    })
  },
  recordCostCharged(costUsd: number, labels: { provider: string; tool: string }) {
    // Unit None: CloudWatch has no USD unit; value is dollars.
    if (costUsd > 0)
      enqueue(HOSTED_KEY_NAMESPACE, 'CostCharged', costUsd, StandardUnit.None, {
        Provider: labels.provider,
        Tool: labels.tool,
      })
  },
  recordThrottled(labels: { provider: string; tool: string; reason: ThrottleReason }) {
    enqueue(HOSTED_KEY_NAMESPACE, 'Throttled', 1, StandardUnit.Count, {
      Provider: labels.provider,
      Tool: labels.tool,
      Reason: labels.reason,
    })
  },
  recordUpstreamRateLimited(labels: { tool: string; key: string }) {
    enqueue(HOSTED_KEY_NAMESPACE, 'UpstreamRateLimited', 1, StandardUnit.Count, {
      Tool: labels.tool,
      Key: labels.key,
    })
  },
  recordQueueWait(durationMs: number, labels: { provider: string; reason: QueueReason }) {
    enqueue(HOSTED_KEY_NAMESPACE, 'QueueWaitDuration', durationMs, StandardUnit.Milliseconds, {
      Provider: labels.provider,
      Reason: labels.reason,
    })
  },
  recordQueueWaitExceeded(labels: { provider: string; reason: QueueReason }) {
    enqueue(HOSTED_KEY_NAMESPACE, 'QueueWaitExceeded', 1, StandardUnit.Count, {
      Provider: labels.provider,
      Reason: labels.reason,
    })
  },
  recordUnknownModelCost(labels: { tool: string }) {
    enqueue(HOSTED_KEY_NAMESPACE, 'UnknownModelCost', 1, StandardUnit.Count, {
      Tool: labels.tool,
    })
  },
}

export const workflowMetrics = {
  recordExecutionStarted(labels: { trigger: string }) {
    enqueue(WORKFLOW_NAMESPACE, 'ExecutionStarted', 1, StandardUnit.Count, {
      Trigger: labels.trigger,
    })
  },
  /**
   * One terminal outcome per execution. Error rate = failed / (success + failed)
   * via CloudWatch metric math over the Status dimension.
   */
  recordExecutionCompleted(labels: {
    trigger: string
    status: WorkflowExecutionStatus
    durationMs?: number
  }) {
    enqueue(WORKFLOW_NAMESPACE, 'ExecutionCompleted', 1, StandardUnit.Count, {
      Trigger: labels.trigger,
      Status: labels.status,
    })
    if (typeof labels.durationMs === 'number') {
      enqueue(
        WORKFLOW_NAMESPACE,
        'ExecutionDuration',
        labels.durationMs,
        StandardUnit.Milliseconds,
        {
          Trigger: labels.trigger,
          Status: labels.status,
        }
      )
    }
  },
  /**
   * Pause is not terminal — the execution resumes and reaches ExecutionCompleted
   * later — so it's tracked separately to keep started-vs-completed math honest.
   */
  recordExecutionPaused(labels: { trigger: string }) {
    enqueue(WORKFLOW_NAMESPACE, 'ExecutionPaused', 1, StandardUnit.Count, {
      Trigger: labels.trigger,
    })
  },
  recordBlockExecuted(labels: {
    blockType: string
    operation?: string
    success: boolean
    durationMs: number
  }) {
    enqueue(WORKFLOW_NAMESPACE, 'BlockExecuted', 1, StandardUnit.Count, {
      BlockType: labels.blockType,
      Operation: labels.operation,
      Success: String(labels.success),
    })
    enqueue(WORKFLOW_NAMESPACE, 'BlockDuration', labels.durationMs, StandardUnit.Milliseconds, {
      BlockType: labels.blockType,
    })
  },
}
