import type { AppActionManifestEntry } from '@/lib/apps/manifest'

/**
 * Merge partial binding updates without treating the incoming list as a full
 * replacement. Existing action order is retained and new actions are appended.
 */
export function mergeRevisionActions(
  existing: AppActionManifestEntry[],
  incoming: AppActionManifestEntry[]
): AppActionManifestEntry[] {
  const incomingById = new Map(incoming.map((action) => [action.actionId, action]))
  const merged = existing.map((action) => incomingById.get(action.actionId) ?? action)
  const existingIds = new Set(existing.map((action) => action.actionId))

  for (const action of incoming) {
    if (!existingIds.has(action.actionId)) merged.push(action)
  }

  return merged
}

export function detachRevisionAction(
  existing: AppActionManifestEntry[],
  actionId: string
): { actions: AppActionManifestEntry[]; detached: boolean } {
  const actions = existing.filter((action) => action.actionId !== actionId)
  return { actions, detached: actions.length !== existing.length }
}
