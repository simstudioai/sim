import { LRUCache } from 'lru-cache'
import { coalesceLocally } from '@/lib/concurrency/singleflight'

/** 403 copy for a workspace whose plan does not include Sim sandbox access. */
export const MAX_PLAN_REQUIRED = 'Sim sandboxes require an active Max or Enterprise plan.'

/**
 * How long a resolved sandbox entitlement stays usable on the execution path.
 * Matches the organization BYOK entitlement, the other plan gate cached this
 * way. Staleness fails in the harmless direction: a workspace whose plan
 * terminally lapsed keeps running attached sandboxes for at most this long,
 * and every run is metered regardless, so nobody is charged wrongly.
 */
export const SANDBOX_ENTITLEMENT_TTL_MS = 60 * 1000

/**
 * Resolved entitlements, with `LRUCache` supplying the TTL and the size bound.
 *
 * Values are booleans, so every read must test `!== undefined` — a plain
 * truthiness check would treat a cached `false` as a miss and re-query a lapsed
 * workspace on every single Function block.
 */
const entitlementCache = new LRUCache<string, boolean>({
  max: 500,
  ttl: SANDBOX_ENTITLEMENT_TTL_MS,
})

/**
 * Whether a workspace may keep executing its attached sandboxes, with bounded
 * staleness.
 *
 * `resolveWorkspaceSandbox` runs once per Function block, so a workflow looping
 * over N items would otherwise pay N billing reads. React's request cache is a
 * no-op in the Trigger.dev workers that run workflows, which is why this is a
 * process cache rather than `cache()`.
 *
 * Billing is reached lazily for the same reason `resolve.ts` reaches the
 * database lazily: the sandbox barrel is imported by the doc compilers and the
 * parity script, which never select a workspace sandbox and must stay
 * importable without a database.
 */
export async function hasWorkspaceSandboxRetentionAccessCached(
  workspaceId: string
): Promise<boolean> {
  const cached = entitlementCache.get(workspaceId)
  if (cached !== undefined) return cached

  /**
   * `coalesceLocally` collapses a parallel or loop block's N simultaneous
   * misses onto one resolution, and bounds a *hung* billing read at its settle
   * deadline rather than wedging every caller for the whole TTL.
   *
   * The cache write stays out here, on the value this caller received. A caller
   * that timed out throws instead of reaching it, and `onError: 'throw'` is what
   * keeps a momentary outage from being recorded as a plan lapse: the resolver
   * otherwise maps a failed read to `false` exactly like a real one.
   */
  const entitled = await coalesceLocally(`sandbox-entitlement:${workspaceId}`, async () => {
    const { hasWorkspaceSandboxRetentionAccess } = await import('@/lib/billing/core/subscription')
    return hasWorkspaceSandboxRetentionAccess(workspaceId, { onError: 'throw' })
  })
  entitlementCache.set(workspaceId, entitled)
  return entitled
}

/**
 * Drops every cached entitlement. Test seam; never called in production code.
 *
 * There is deliberately no per-workspace invalidator: plan changes arrive on a
 * Stripe webhook, which lands in one process while the readers are per-worker,
 * so an invalidator would look like it made a change immediate when it only
 * cleared one process. The TTL is the real mechanism.
 */
export function resetSandboxEntitlementCache(): void {
  entitlementCache.clear()
}
