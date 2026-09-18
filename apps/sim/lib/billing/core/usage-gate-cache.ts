import { LRUCache } from 'lru-cache'
import {
  type AttributedUsageLimitsResult,
  type BillingAttributionSnapshot,
  checkAttributedUsageLimits,
} from '@/lib/billing/core/billing-attribution'
import { coalesceLocally } from '@/lib/concurrency/singleflight'

/**
 * How long a usage-gate answer stays usable on the high-frequency paths.
 *
 * The gate sums the payer's usage ledger for the billing period, which grows
 * with the payer's activity, so a large organization scans its whole period on
 * every uncached call. Bulk ingestion re-checks per document and knowledge
 * search checks per query. Staleness is bounded by this TTL and fails in the
 * harmless direction: a payer who crosses their limit keeps going for at most
 * this long, which charges nobody wrongly.
 */
export const USAGE_GATE_TTL_MS = 60 * 1000

/**
 * Recent gate answers, admitted and refused, with `LRUCache` supplying the TTL
 * and the size bound. Each entry point decides which of them it may serve.
 */
const gateCache = new LRUCache<string, AttributedUsageLimitsResult>({
  max: 10_000,
  ttl: USAGE_GATE_TTL_MS,
})

/**
 * The gate depends on who pays, for which period, under which plan, and which
 * member acts: the payer pool, its limit and the per-member cap are all part of
 * the answer. The workspace is not, so every workspace of one payer shares an
 * entry.
 */
function gateKey(attribution: BillingAttributionSnapshot): string {
  const subscription = attribution.payerSubscription
  return [
    attribution.billingEntity.type,
    attribution.billingEntity.id,
    attribution.billingPeriod.start,
    attribution.billingPeriod.end,
    attribution.billedAccountUserId,
    attribution.actorUserId,
    subscription?.id ?? '',
    subscription?.plan ?? '',
    subscription?.status ?? '',
    subscription?.seats ?? '',
  ].join(':')
}

/**
 * Serves a cached answer the caller accepts, otherwise reads the gate.
 *
 * `coalesceLocally` collapses concurrent misses onto one ledger read and bounds
 * a hung read at its settle deadline. A failed read throws without writing, so
 * an outage is never recorded as an answer. The write stays on the value this
 * caller received, so a producer that timed out and later resolved cannot
 * overwrite a fresher answer.
 *
 * There is deliberately no invalidator: usage and limit changes land in other
 * processes (execution workers, Stripe webhooks), so the TTL is the real bound.
 */
async function checkUsageLimitsThroughCache(
  attribution: BillingAttributionSnapshot,
  serveCachedRefusal: boolean
): Promise<AttributedUsageLimitsResult> {
  const key = gateKey(attribution)
  const cached = gateCache.get(key)
  if (cached !== undefined && (serveCachedRefusal || !cached.isExceeded)) return cached

  const result = await coalesceLocally(`usage-gate:${key}`, () =>
    checkAttributedUsageLimits(attribution)
  )
  gateCache.set(key, result)
  return result
}

/**
 * {@link checkAttributedUsageLimits} for background ingestion. Serves admitted
 * and refused answers alike: nothing on this path has a person waiting for a
 * raised limit to apply, so a refused payer waits at most the TTL.
 */
export function checkIngestionUsageLimits(
  attribution: BillingAttributionSnapshot
): Promise<AttributedUsageLimitsResult> {
  return checkUsageLimitsThroughCache(attribution, true)
}

/**
 * {@link checkAttributedUsageLimits} for knowledge search. Serves only a cached
 * admission: a refusal is always re-read, so a payer who just raised their limit
 * or upgraded is never held behind a cached block while they wait on a search.
 * Every other interactive caller (uploads, execution admission, the settings
 * surfaces) keeps reading the gate fresh.
 */
export function checkSearchUsageLimits(
  attribution: BillingAttributionSnapshot
): Promise<AttributedUsageLimitsResult> {
  return checkUsageLimitsThroughCache(attribution, false)
}

/** Drops every cached gate answer. Test seam; never called in production code. */
export function resetUsageGateCache(): void {
  gateCache.clear()
}
