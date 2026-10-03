import { LRUCache } from 'lru-cache'
import { resolveOrganizationPlan } from '@/lib/billing/core/subscription'
import { coalesceLocally } from '@/lib/concurrency/singleflight'
import { isHosted } from '@/lib/core/config/env-flags'

/**
 * How long a resolved entitlement stays usable on the execution path. Matches
 * `SESSION_POLICY_CACHE_TTL_MS`, the other org-keyed policy gate cached this
 * way. Staleness fails in the harmless direction: a lapsed organization keeps
 * using its own provider key for at most this long, which costs Sim a little
 * metering and never charges anyone wrongly. The key material itself is never
 * cached — `getBYOKKey` reads the key rows fresh so revocation is immediate.
 */
export const ORGANIZATION_BYOK_ENTITLEMENT_TTL_MS = 60 * 1000

/**
 * Resolved entitlements, with `LRUCache` supplying the TTL and the size bound.
 *
 * Values are booleans, so every read must test `!== undefined` — a plain
 * truthiness check would treat a cached `false` as a miss and re-query an
 * unentitled organization on every single resolution.
 */
const entitlementCache = new LRUCache<string, boolean>({
  max: 500,
  ttl: ORGANIZATION_BYOK_ENTITLEMENT_TTL_MS,
})

/**
 * Authoritative organization BYOK entitlement, read fresh.
 *
 * Organization BYOK is available to every paying organization on Sim Cloud —
 * Pro for Teams, Max for Teams, and Enterprise — since an organization is the
 * only thing that can hold the keys. It is not an Enterprise-only entitlement.
 *
 * Use this wherever a human is waiting on the answer (the settings surfaces and
 * the management use cases): an organization that just upgraded must not be
 * told it still lacks a plan. The execution path uses
 * {@link isOrganizationBYOKEntitledCached} instead.
 */
export async function isOrganizationBYOKEntitled(organizationId: string): Promise<boolean> {
  return isHosted && (await resolveOrganizationPlan(organizationId))
}

/**
 * Organization BYOK entitlement for the execution path, with bounded staleness.
 *
 * `getBYOKKey` runs once per agent block and once per hosted-capable tool call,
 * so a workflow looping over N items resolves N times. Reading the entitlement
 * fresh there costs three sequential billing queries per resolution for the
 * organization-inheriting case; this collapses the steady state to zero.
 *
 * Deliberately separate from {@link isOrganizationBYOKEntitled} rather than
 * caching inside it: the tradeoff is only correct where nothing is waiting on a
 * plan change to appear, which is true of a workflow run and false of the
 * settings page.
 */
export async function isOrganizationBYOKEntitledCached(organizationId: string): Promise<boolean> {
  if (!isHosted) return false

  const cached = entitlementCache.get(organizationId)
  if (cached !== undefined) return cached

  /**
   * `coalesceLocally` collapses a parallel or loop block's N simultaneous
   * misses onto one resolution, and bounds a *hung* billing read at its settle
   * deadline rather than wedging every caller for the whole TTL.
   *
   * The cache write stays out here, on the value this caller actually received,
   * rather than inside the producer. `coalesceLocally` does not cancel a
   * producer it timed out — it keeps running detached — so a write from inside
   * could land after a retry already cached a fresher answer and overwrite it
   * for a full TTL. A caller that timed out throws instead of reaching this
   * line, and the abandoned producer resolves into nothing.
   *
   * Only reaching the write on success is also what keeps a momentary outage
   * from being recorded as a plan lapse; `onError: 'throw'` is what makes that
   * outage distinguishable, since the resolver otherwise maps a failed read to
   * `false` exactly like a real lapse.
   */
  const entitled = await coalesceLocally(`byok-entitlement:${organizationId}`, () =>
    resolveOrganizationPlan(organizationId, { onError: 'throw' })
  )
  entitlementCache.set(organizationId, entitled)
  return entitled
}

/**
 * Drops every cached entitlement. Test seam; never called in production code.
 *
 * There is deliberately no per-organization invalidator, unlike
 * `invalidateSessionPolicyCache`. That one works because the route that mutates
 * the policy runs in the same process that reads it. Entitlement changes arrive
 * on a Stripe webhook, which lands in one process while the readers are
 * per-worker — an invalidator there would look like it made plan changes
 * immediate when it only cleared one process. The TTL is the real mechanism.
 */
export function resetOrganizationBYOKEntitlementCache(): void {
  entitlementCache.clear()
}
