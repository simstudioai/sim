import { LRUCache } from 'lru-cache'
import { USAGE_LEDGER_STATEMENT_TIMEOUT_MS } from '@/lib/billing/constants'
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
 * this long, which charges nobody wrongly. Five minutes: the sum is a few
 * hundred milliseconds for a busy payer, and a minute made every search after
 * a pause pay it.
 */
export const USAGE_GATE_TTL_MS = 5 * 60 * 1000

/**
 * How long a coalesced usage read may take before its callers give up on it. The read's cost is
 * the ledger sum, which the database ends at {@link USAGE_LEDGER_STATEMENT_TIMEOUT_MS}; the
 * remainder is a few indexed lookups and the connection waits around them. The singleflight
 * default of 30 s exists to bound a hung producer, and a slow sum is not a hung one: given up on
 * early, it keeps running detached while every joined caller fails and the next caller starts a
 * second sum alongside it. Derived from the statement bound so the database always ends the sum
 * first, and the gate only gives up on a connection that never answers.
 */
export const USAGE_GATE_SETTLE_TIMEOUT_MS = USAGE_LEDGER_STATEMENT_TIMEOUT_MS + 15_000

/**
 * Recent gate answers, admitted and refused, with `LRUCache` supplying the TTL
 * and the size bound. Each entry point decides which of them it may serve.
 */
const gateCache = new LRUCache<string, AttributedUsageLimitsResult>({
  max: 10_000,
  ttl: USAGE_GATE_TTL_MS,
})

/**
 * The gate depends on who pays, for which period (and how that period was
 * derived), under which plan, and which member acts: the payer pool, its limit
 * and the per-member cap are all part of the answer. The workspace is not, so
 * every workspace of one payer shares an entry.
 */
function gateKey(attribution: BillingAttributionSnapshot): string {
  const subscription = attribution.payerSubscription
  return [
    attribution.billingEntity.type,
    attribution.billingEntity.id,
    attribution.billingPeriod.start,
    attribution.billingPeriod.end,
    attribution.billingPeriod.source ?? '',
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
 * `cacheRefusals` governs both directions: a caller that must re-read refusals
 * also never stores one, so a refusal read on the search path never reaches
 * ingestion. The usage read fails closed (a ledger error comes back as
 * exceeded), which makes that the only way a search-path outage stays out of
 * the cache. A read that throws writes nothing.
 *
 * `coalesceLocally` collapses concurrent misses onto one ledger read and bounds
 * a hung read at {@link USAGE_GATE_SETTLE_TIMEOUT_MS}. The write stays on the
 * value this caller received, so a producer that timed out and later resolved
 * cannot overwrite a fresher answer.
 *
 * There is deliberately no invalidator: usage and limit changes land in other
 * processes (execution workers, Stripe webhooks), so the TTL is the real bound.
 */
async function checkUsageLimitsThroughCache(
  attribution: BillingAttributionSnapshot,
  cacheRefusals: boolean
): Promise<AttributedUsageLimitsResult> {
  const key = gateKey(attribution)
  const cached = gateCache.get(key)
  if (cached !== undefined && (cacheRefusals || !cached.isExceeded)) return cached

  const result = await coalesceLocally(
    `usage-gate:${key}`,
    () => checkAttributedUsageLimits(attribution),
    USAGE_GATE_SETTLE_TIMEOUT_MS
  )
  if (cacheRefusals || !result.isExceeded) gateCache.set(key, result)
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
 * Every other interactive caller (uploads, the settings surfaces) keeps reading
 * the gate fresh.
 */
export function checkSearchUsageLimits(
  attribution: BillingAttributionSnapshot
): Promise<AttributedUsageLimitsResult> {
  return checkUsageLimitsThroughCache(attribution, false)
}

/**
 * {@link checkAttributedUsageLimits} for the execution path, the highest-volume
 * reader of the gate. Same policy as search: only an admission is served from
 * cache, so a raised limit applies on the next run. The admission's usage figure
 * is up to one TTL stale, which widens the execution-slot reservation headroom
 * by that much and no more.
 */
export function checkExecutionUsageLimits(
  attribution: BillingAttributionSnapshot
): Promise<AttributedUsageLimitsResult> {
  return checkUsageLimitsThroughCache(attribution, false)
}

/** Drops every cached gate answer. Test seam; never called in production code. */
export function resetUsageGateCache(): void {
  gateCache.clear()
}
