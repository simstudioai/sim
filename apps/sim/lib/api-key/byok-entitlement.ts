import { LRUCache } from 'lru-cache'
import { resolveOrganizationPlan } from '@/lib/billing/core/subscription'
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
 * Caches the in-flight promise rather than the resolved boolean, following
 * `lib/copilot/entitlements.ts`. Storing the promise is what makes concurrent
 * callers collapse onto one resolution: a parallel or loop block resolving N
 * items issues one query set instead of N, with no separate in-flight
 * bookkeeping. `LRUCache` supplies the TTL and the size bound.
 */
const entitlementCache = new LRUCache<string, Promise<boolean>>({
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
export function isOrganizationBYOKEntitledCached(organizationId: string): Promise<boolean> {
  if (!isHosted) return Promise.resolve(false)

  const cached = entitlementCache.get(organizationId)
  if (cached) return cached

  /**
   * `onError: 'throw'` is load-bearing: the resolver otherwise maps a failed
   * billing read to `false`, indistinguishable from a real plan lapse, and a
   * cached `false` would silently meter every inheriting run for the whole TTL.
   */
  const resolution = resolveOrganizationPlan(organizationId, { onError: 'throw' })
  entitlementCache.set(organizationId, resolution)

  /**
   * Caching the promise means a rejected one would stay cached for the full TTL
   * — the neighbour in `copilot/entitlements.ts` never has to think about this
   * because its evaluators swallow their own errors. Evicting on rejection is
   * what keeps a momentary billing outage from pinning the gate shut. The
   * caller still sees the rejection through `resolution`; `getBYOKKey` catches
   * it and falls back for that one call.
   */
  resolution.catch(() => entitlementCache.delete(organizationId))

  return resolution
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
