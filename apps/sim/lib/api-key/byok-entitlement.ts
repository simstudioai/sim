import { resolveOrganizationPlan } from '@/lib/billing/core/subscription'
import { isHosted } from '@/lib/core/config/env-flags'

/**
 * How long a resolved entitlement stays usable on the execution path. Staleness
 * fails in the harmless direction: a lapsed organization keeps using its own
 * provider key for at most this long, which costs Sim a little metering and
 * never charges anyone wrongly. The key material itself is never cached — see
 * `getBYOKKey`, which reads the key rows fresh so revocation is immediate.
 */
const ENTITLEMENT_TTL_MS = 60_000

/**
 * Upper bound on cached organizations per process. Entries are two words each,
 * so this exists only to keep a long-lived worker from growing without limit
 * when it serves many organizations. Insertion order is eviction order.
 */
const ENTITLEMENT_CACHE_MAX_ENTRIES = 1_000

interface CachedEntitlement {
  /** Last resolved value, or `null` while the first resolution is in flight. */
  value: boolean | null
  expiresAt: number
  /** Shared in-flight resolution, so concurrent blocks issue one query set. */
  inflight: Promise<boolean> | null
}

const entitlementCache = new Map<string, CachedEntitlement>()

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
  if (cached) {
    if (cached.inflight) return cached.inflight
    if (cached.value !== null && cached.expiresAt > Date.now()) return cached.value
  }

  const inflight = resolveOrganizationPlan(organizationId).then(
    (entitled) => {
      entitlementCache.set(organizationId, {
        value: entitled,
        expiresAt: Date.now() + ENTITLEMENT_TTL_MS,
        inflight: null,
      })
      return entitled
    },
    (error) => {
      entitlementCache.delete(organizationId)
      throw error
    }
  )

  if (entitlementCache.size >= ENTITLEMENT_CACHE_MAX_ENTRIES) {
    const oldest = entitlementCache.keys().next()
    if (!oldest.done) entitlementCache.delete(oldest.value)
  }
  entitlementCache.set(organizationId, {
    value: cached?.value ?? null,
    expiresAt: 0,
    inflight,
  })

  return inflight
}

/** Drops every cached entitlement. Test seam; never called in production code. */
export function resetOrganizationBYOKEntitlementCache(): void {
  entitlementCache.clear()
}
