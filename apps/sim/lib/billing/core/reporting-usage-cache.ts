import { db } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { randomInt } from '@sim/utils/random'
import { LRUCache } from 'lru-cache'
import {
  type BillingEntity,
  getBillingPeriodUsageCost,
  type UsageQueryPeriod,
} from '@/lib/billing/core/usage-log'
import { getRedisClient } from '@/lib/core/config/redis'
import { withinDeadline } from '@/lib/core/utils/deadline'
import type { DbClient } from '@/lib/db/types'

const logger = createLogger('ReportingUsageCache')

/**
 * How long a reporting-window usage sum is served before it is summed again.
 *
 * A reporting window is an enterprise contract period, up to a year long, so its sum scans every
 * ledger row the payer wrote in that year, and the soft gates below re-ran it once per billable
 * event. The ledger only grows within a window (rows are inserted at a cost above zero, and the
 * one update is a monotonic top-up), so a served sum is never above the true one: it omits at
 * most the usage written since it was read. That is the safe direction for every reader here —
 * an admission gate lets a payer run on for at most this long past their limit, and a sum at or
 * above the limit is a refusal the true sum would also give. Thirty seconds keeps that overrun
 * small against a year-long allowance while turning a per-event scan into one per window.
 *
 * A sum is held both in Redis, shared by every process, and in each process that reads it, so a
 * served sum can be up to twice this old (plus the Redis expiry's jitter).
 */
export const REPORTING_USAGE_CACHE_TTL_MS = 30_000

/** Redis expiry is jittered by up to this much, so payers summed together do not expire together. */
const SHARED_TTL_JITTER_MS = 5_000

/**
 * How long a read waits on Redis before summing the ledger instead. The shared client queues
 * commands while disconnected and has long timeouts, so without this a Redis outage would stall
 * every gate behind it rather than cost one sum.
 */
const SHARED_READ_TIMEOUT_MS = 250

/** Bump when a stored sum's meaning changes; old entries are then ignored. */
const SHARED_KEY_VERSION = 'v1'

/** A usage window known to be an enterprise reporting window — the only kind this cache serves. */
type ReportingQueryPeriod = UsageQueryPeriod & { source: 'reporting' }

function sharedReportingUsageKey(key: string): string {
  return `usage:reporting:${SHARED_KEY_VERSION}:${key}`
}

/**
 * A sum another process stored, or `undefined` when there is none to use. Redis being absent,
 * slow, or failing, and a value that is not a non-negative number, are all misses: the caller
 * sums the ledger, so the cache can cost a read its latency but never its answer.
 */
async function readSharedReportingUsageCost(key: string): Promise<number | undefined> {
  const redis = getRedisClient()
  if (!redis) return undefined
  try {
    const stored = await withinDeadline(
      () => redis.get(sharedReportingUsageKey(key)),
      Date.now() + SHARED_READ_TIMEOUT_MS
    )
    if (stored === null) return undefined
    const cost = Number(stored)
    if (stored.trim() !== '' && Number.isFinite(cost) && cost >= 0) return cost
    logger.warn('Discarding unreadable shared reporting usage', { key })
  } catch (error) {
    logger.warn('Shared reporting usage read failed; summing the ledger', {
      error: getErrorMessage(error),
    })
  }
  return undefined
}

/** Fire-and-forget: a read never waits on, or fails because of, the shared write. */
function writeSharedReportingUsageCost(key: string, cost: number): void {
  const redis = getRedisClient()
  if (!redis) return
  const ttlMs = REPORTING_USAGE_CACHE_TTL_MS + randomInt(0, SHARED_TTL_JITTER_MS)
  redis.set(sharedReportingUsageKey(key), String(cost), 'PX', ttlMs).catch((error: unknown) => {
    logger.warn('Shared reporting usage write failed', { error: getErrorMessage(error) })
  })
}

/**
 * The sum from Redis when another process stored one, else the ledger's exact sum, stored for
 * the others. Trigger.dev runs each task in a fresh process, so the in-process cache alone is
 * always cold there; the shared value is what spares those runs the scan.
 */
async function sumReportingUsageCost(
  key: string,
  entity: BillingEntity,
  period: ReportingQueryPeriod
): Promise<number> {
  const shared = await readSharedReportingUsageCost(key)
  if (shared !== undefined) return shared
  const cost = await getBillingPeriodUsageCost(entity, period)
  writeSharedReportingUsageCost(key, cost)
  return cost
}

/**
 * Sums held by this process, one per payer and window, in front of the shared Redis value. Every
 * key is an enterprise payer's current window, a few dozen bytes each, so the ceiling sits far
 * above any process's working set and only backstops memory; an eviction inside the TTL costs
 * one extra read.
 *
 * `fetchMethod` coalesces concurrent misses onto one read. A rejected sum is evicted rather than
 * stored (`noDeleteOnFetchRejection` and `allowStaleOnFetchRejection` stay off), so every caller
 * of that read sees the error it would have seen uncached and the next call sums again. There is
 * no settle deadline: the sum runs under the ledger's own `statement_timeout`, so the database
 * ends a slow one. There is deliberately no invalidator or lock either — usage is written by
 * execution workers in other processes, so the TTL is the real bound, and concurrent misses in
 * different processes each sum once.
 */
const reportingUsageCache = new LRUCache<
  string,
  number,
  { entity: BillingEntity; period: ReportingQueryPeriod }
>({
  max: 1_000,
  ttl: REPORTING_USAGE_CACHE_TTL_MS,
  fetchMethod: (key, _stale, { context }) =>
    sumReportingUsageCost(key, context.entity, context.period),
})

/**
 * The key names the period's source as well as its bounds, so a sum can only ever be shared
 * with a read of the same kind of window, even if another source someday reaches this cache.
 */
function reportingUsageKey(entity: BillingEntity, period: ReportingQueryPeriod): string {
  return `${entity.type}:${entity.id}:${period.source}:${period.start.toISOString()}:${period.end.toISOString()}`
}

function isReportingPeriod(period: UsageQueryPeriod): period is ReportingQueryPeriod {
  return period.source === 'reporting'
}

async function readCachedReportingUsageCost(
  entity: BillingEntity,
  period: ReportingQueryPeriod
): Promise<number> {
  const cost = await reportingUsageCache.fetch(reportingUsageKey(entity, period), {
    context: { entity, period },
  })
  return cost !== undefined ? cost : getBillingPeriodUsageCost(entity, period)
}

/**
 * Period usage for a soft reader: an admission check, a display, or a level-triggered
 * notification that tolerates the cache's bounded under-count. Enterprise reporting windows are
 * served from the shared cache for up to twice {@link REPORTING_USAGE_CACHE_TTL_MS}, since their
 * year-long sum is the expensive one; every other period is summed exactly, as before. A read on
 * a caller's own executor (a transaction or a replica) keeps its own snapshot and is never shared.
 * Never use it for invoicing, cycle close, an edge-triggered decision, or a read that must see its
 * own write.
 */
export function readSoftGateUsageCost(
  entity: BillingEntity,
  period: UsageQueryPeriod,
  executor: DbClient = db
): Promise<number> {
  if (isReportingPeriod(period) && executor === db) {
    return readCachedReportingUsageCost(entity, period)
  }
  return getBillingPeriodUsageCost(entity, period, undefined, executor)
}
