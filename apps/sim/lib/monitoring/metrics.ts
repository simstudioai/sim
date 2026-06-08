/**
 * Hosted-key OTel metrics.
 *
 * Point events (usage, cost, throttles, queue waits) are emitted as metrics —
 * not spans — so they bypass trace sampling and survive aggregation. Reads the
 * global MeterProvider, which the Next.js app registers in `instrumentation-node.ts`
 * and trigger.dev registers from `trigger.config.ts`; with no provider the API
 * returns a no-op meter, so these recorders are always safe to call.
 *
 * Labels stay low-cardinality (provider, tool, reason, key). `key` is the env var
 * NAME of the chosen hosted key (e.g. `PERPLEXITY_API_KEY_2`) — never the secret —
 * and the pool is operator-managed, so it's safe to label. Per-workspace/user cost
 * lives exactly in the `usage_log` table — never put those on metric labels.
 */

import { type Counter, type Histogram, metrics } from '@opentelemetry/api'

const METER_NAME = 'sim.hosted-key'
const METER_VERSION = '1.0.0'

type ThrottleReason = 'billing_actor_limit' | 'upstream_retries_exhausted'
type QueueReason = 'actor_requests' | 'dimension' | 'queue_position'
type FailureReason = 'rate_limited' | 'auth' | 'other'

let meter: ReturnType<typeof metrics.getMeter> | undefined
let usedCounter: Counter | undefined
let failedCounter: Counter | undefined
let costCounter: Counter | undefined
let throttledCounter: Counter | undefined
let upstreamRateLimitedCounter: Counter | undefined
let queueWaitHistogram: Histogram | undefined
let queueWaitExceededCounter: Counter | undefined
let unknownModelCostCounter: Counter | undefined

function getMeter() {
  if (!meter) meter = metrics.getMeter(METER_NAME, METER_VERSION)
  return meter
}

function getUsedCounter() {
  if (!usedCounter) {
    usedCounter = getMeter().createCounter('hosted_key.used', {
      description: 'Successful tool executions backed by a Sim-hosted API key',
    })
  }
  return usedCounter
}

function getFailedCounter() {
  if (!failedCounter) {
    failedCounter = getMeter().createCounter('hosted_key.failed', {
      description: 'Failed tool executions backed by a Sim-hosted API key',
    })
  }
  return failedCounter
}

function getCostCounter() {
  if (!costCounter) {
    costCounter = getMeter().createCounter('hosted_key.cost_charged', {
      description: 'Dollar cost charged to the billing actor for hosted-key usage',
      unit: 'USD',
    })
  }
  return costCounter
}

function getThrottledCounter() {
  if (!throttledCounter) {
    throttledCounter = getMeter().createCounter('hosted_key.throttled', {
      description: 'Rate-limit errors surfaced to the end user (not retried/absorbed)',
    })
  }
  return throttledCounter
}

function getUpstreamRateLimitedCounter() {
  if (!upstreamRateLimitedCounter) {
    upstreamRateLimitedCounter = getMeter().createCounter('hosted_key.upstream_rate_limited', {
      description: 'Upstream provider 429s absorbed via retry/backoff',
    })
  }
  return upstreamRateLimitedCounter
}

function getQueueWaitHistogram() {
  if (!queueWaitHistogram) {
    queueWaitHistogram = getMeter().createHistogram('hosted_key.queue_wait_duration', {
      description: 'Time a hosted-key acquisition spent waiting in the per-workspace queue/bucket',
      unit: 'ms',
    })
  }
  return queueWaitHistogram
}

function getQueueWaitExceededCounter() {
  if (!queueWaitExceededCounter) {
    queueWaitExceededCounter = getMeter().createCounter('hosted_key.queue_wait_exceeded', {
      description: 'Hosted-key acquisitions that exceeded the queue wait cap and fell back to 429',
    })
  }
  return queueWaitExceededCounter
}

function getUnknownModelCostCounter() {
  if (!unknownModelCostCounter) {
    unknownModelCostCounter = getMeter().createCounter('hosted_key.unknown_model_cost', {
      description: 'Hosted-key cost calculations that fell back to a default for an unmapped model',
    })
  }
  return unknownModelCostCounter
}

export const hostedKeyMetrics = {
  recordUsed(labels: { provider: string; tool: string; key: string }) {
    getUsedCounter().add(1, labels)
  },
  recordFailed(labels: { provider: string; tool: string; key: string; reason: FailureReason }) {
    getFailedCounter().add(1, labels)
  },
  recordCostCharged(costUsd: number, labels: { provider: string; tool: string }) {
    if (costUsd > 0) getCostCounter().add(costUsd, labels)
  },
  recordThrottled(labels: { provider: string; tool: string; reason: ThrottleReason }) {
    getThrottledCounter().add(1, labels)
  },
  recordUpstreamRateLimited(labels: { tool: string; key: string }) {
    getUpstreamRateLimitedCounter().add(1, labels)
  },
  recordQueueWait(durationMs: number, labels: { provider: string; reason: QueueReason }) {
    getQueueWaitHistogram().record(durationMs, labels)
  },
  recordQueueWaitExceeded(labels: { provider: string; reason: QueueReason }) {
    getQueueWaitExceededCounter().add(1, labels)
  },
  recordUnknownModelCost(labels: { tool: string }) {
    getUnknownModelCostCounter().add(1, labels)
  },
}
