import { LRUCache } from 'lru-cache'
import { type BlockVisibilityState, getBlockVisibility } from '@/lib/core/config/block-visibility'
import { getWorkspaceWithOwner } from '@/lib/workspaces/permissions/utils'

/**
 * Copilot-side resolver for the viewer's block-visibility projection.
 *
 * A single mothership turn fans out into many Go→Sim tool callbacks; resolving
 * visibility per callback would repeat the workspace→org lookup (and, for
 * admin-gated rules, a replica read) N times. This memoizes the resolved state
 * per (userId, workspaceId) for a short TTL matching the AppConfig cache
 * cadence, so a turn costs at most one resolution.
 */
const VISIBILITY_CACHE_TTL_MS = 30_000

const visibilityCache = new LRUCache<string, Promise<BlockVisibilityState>>({
  max: 1000,
  ttl: VISIBILITY_CACHE_TTL_MS,
})

async function resolveVisibility(
  userId: string,
  workspaceId?: string
): Promise<BlockVisibilityState> {
  const orgId = workspaceId
    ? (await getWorkspaceWithOwner(workspaceId, { includeArchived: true }))?.organizationId
    : undefined
  return getBlockVisibility({ userId, orgId })
}

/** The viewer's visibility state, memoized per (userId, workspaceId) for ~30s. */
export function getBlockVisibilityForCopilot(
  userId: string,
  workspaceId?: string
): Promise<BlockVisibilityState> {
  const key = `${userId}:${workspaceId ?? ''}`
  let promise = visibilityCache.get(key)
  if (!promise) {
    promise = resolveVisibility(userId, workspaceId).catch((error) => {
      visibilityCache.delete(key)
      throw error
    })
    visibilityCache.set(key, promise)
  }
  return promise
}

/**
 * Stable signature of a visibility state, for keying caches whose contents
 * depend on the gated projection (e.g. the integration tool-schema LRU).
 */
export function visibilitySignature(vis: BlockVisibilityState): string {
  return JSON.stringify([
    [...vis.revealed].sort(),
    [...vis.disabled].sort(),
    [...vis.previewTagged].sort(),
  ])
}
