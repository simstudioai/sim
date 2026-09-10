import { LRUCache } from 'lru-cache'
import {
  type AttributedUsageLimitsResult,
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
} from '@/lib/billing/core/billing-attribution'
import { coalesceLocally } from '@/lib/concurrency/singleflight'

/**
 * How long a usage-gate answer stays usable on the ingestion path.
 *
 * The gate sums the payer's usage ledger for the billing period, which grows
 * with every indexed document, so a bulk sync that re-checks per document
 * reads the whole period's ledger tens of thousands of times. Staleness fails
 * in the harmless direction: a payer at their limit keeps indexing for at most
 * this long, and a payer whose limit was just raised waits at most this long.
 * Nothing on this path has a person waiting for the answer.
 */
export const INGESTION_USAGE_GATE_TTL_MS = 60 * 1000

/** Recent gate answers, with `LRUCache` supplying the TTL and the size bound. */
const gateCache = new LRUCache<string, AttributedUsageLimitsResult>({
  max: 10_000,
  ttl: INGESTION_USAGE_GATE_TTL_MS,
})

/**
 * The gate depends on who pays, for which period, and which member acts: the
 * payer pool and the per-member cap are both part of the answer.
 */
function gateKey(attribution: BillingAttributionSnapshot): string {
  return [
    attribution.billingEntity.type,
    attribution.billingEntity.id,
    attribution.billingPeriod.start,
    attribution.billingPeriod.end,
    attribution.billedAccountUserId,
    attribution.actorUserId,
  ].join(':')
}

/**
 * {@link checkAttributedUsageLimits} for background ingestion, with bounded
 * staleness. Interactive callers (uploads, search, the settings surfaces) keep
 * reading the gate fresh so a limit change is visible at once.
 *
 * `coalesceLocally` collapses the concurrent misses of a batch onto one ledger
 * read and bounds a hung read at its settle deadline. The cache write stays on
 * the value this caller received, so a producer that timed out and later
 * resolved cannot overwrite a fresher answer.
 */
export async function checkIngestionUsageLimits(
  attribution: BillingAttributionSnapshot
): Promise<AttributedUsageLimitsResult> {
  const key = gateKey(attribution)
  const cached = gateCache.get(key)
  if (cached !== undefined) return cached

  const result = await coalesceLocally(`ingestion-usage-gate:${key}`, () =>
    checkAttributedUsageLimits(attribution)
  )
  gateCache.set(key, result)
  return result
}

/** Drops every cached gate answer. Test seam; never called in production code. */
export function resetIngestionUsageGateCache(): void {
  gateCache.clear()
}
