import type { PinnedResourceType } from '@/lib/api/contracts/pinned-items'

/**
 * Lives in this standalone module — like {@link file://./folder-keys.ts} and
 * {@link file://./table-keys.ts} — so a server prefetch can hydrate the pinned lists without
 * importing `@/hooks/queries/pinned-items`, which pulls the contracts barrel and the
 * optimistic-mutation machinery in with it. The contract import here is type-only, so it
 * erases at build time.
 */

/** Shared with the server prefetch so a hydrated list and a client fetch never disagree. */
export const PINNED_ITEMS_STALE_TIME = 60 * 1000

export const pinnedItemKeys = {
  all: ['pinnedItems'] as const,
  lists: () => [...pinnedItemKeys.all, 'list'] as const,
  /** Prefix covering every per-resourceType list in a workspace — the invalidation target. */
  workspaceLists: (workspaceId?: string) => [...pinnedItemKeys.lists(), workspaceId ?? ''] as const,
  list: (workspaceId?: string, resourceType?: PinnedResourceType) =>
    [...pinnedItemKeys.workspaceLists(workspaceId), resourceType ?? ''] as const,
}
