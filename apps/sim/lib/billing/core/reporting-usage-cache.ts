import { db } from '@sim/db'
import { LRUCache } from 'lru-cache'
import {
  type BillingEntity,
  getBillingPeriodUsageCost,
  type UsageQueryPeriod,
} from '@/lib/billing/core/usage-log'
import type { DbClient } from '@/lib/db/types'

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
 */
export const REPORTING_USAGE_CACHE_TTL_MS = 30_000

/** A usage window known to be an enterprise reporting window — the only kind this cache serves. */
type ReportingQueryPeriod = UsageQueryPeriod & { source: 'reporting' }

/**
 * Sums shared across callers, one per payer and window. Every key is an enterprise payer's
 * current window, a few dozen bytes each, so the ceiling sits far above any process's working
 * set and only backstops memory; an eviction inside the TTL costs one extra sum.
 *
 * `fetchMethod` coalesces concurrent misses onto one sum. A rejected sum is evicted rather than
 * stored (`noDeleteOnFetchRejection` and `allowStaleOnFetchRejection` stay off), so every caller
 * of that read sees the error it would have seen uncached and the next call sums again. There is
 * no settle deadline: the sum runs under the ledger's own `statement_timeout`, so the database
 * ends a slow one. There is deliberately no invalidator either — usage is written by execution
 * workers in other processes, so the TTL is the real bound.
 */
const reportingUsageCache = new LRUCache<
  string,
  number,
  { entity: BillingEntity; period: ReportingQueryPeriod }
>({
  max: 1_000,
  ttl: REPORTING_USAGE_CACHE_TTL_MS,
  fetchMethod: (_key, _stale, { context }) =>
    getBillingPeriodUsageCost(context.entity, context.period),
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
 * served from the shared cache for up to {@link REPORTING_USAGE_CACHE_TTL_MS}, since their
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
