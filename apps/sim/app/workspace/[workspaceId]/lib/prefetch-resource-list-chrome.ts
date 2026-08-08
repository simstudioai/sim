import type { QueryClient } from '@tanstack/react-query'
import type { PinnedResourceType } from '@/lib/api/contracts/pinned-items'
import { listPinnedItemsForViewer } from '@/lib/pinned-items/queries'
import { getWorkspaceMemberProfiles } from '@/lib/workspaces/permissions/utils'
import { PINNED_ITEMS_STALE_TIME, pinnedItemKeys } from '@/hooks/queries/utils/pinned-item-keys'
import { WORKSPACE_MEMBERS_STALE_TIME, workspaceKeys } from '@/hooks/queries/workspace'

/**
 * Prefetches the two lists every foldered resource page needs to paint a row completely,
 * beyond the resources themselves.
 *
 * Pinned ids are not decoration: they are the list's primary sort key, so a page that paints
 * before they land renders the whole list in the wrong order and then visibly re-sorts. Two
 * lists are needed because a folder pins under `resourceType: 'folder'`, a different pin
 * namespace from the resource beside it.
 *
 * Members back the Owner column; without them every owner cell paints empty and fills in
 * after. Both are cheap and shared with the page's own list prefetch in one `Promise.all`.
 *
 * The caller has already authorized the viewer against `workspaceId`.
 */
export async function prefetchResourceListChrome(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string,
  resourceType: PinnedResourceType
): Promise<void> {
  const prefetchPinned = (type: PinnedResourceType) =>
    queryClient.prefetchQuery({
      queryKey: pinnedItemKeys.list(workspaceId, type),
      queryFn: () => listPinnedItemsForViewer(userId, workspaceId, type),
      staleTime: PINNED_ITEMS_STALE_TIME,
    })

  await Promise.all([
    prefetchPinned(resourceType),
    prefetchPinned('folder'),
    queryClient.prefetchQuery({
      queryKey: workspaceKeys.members(workspaceId),
      queryFn: () => getWorkspaceMemberProfiles(workspaceId),
      staleTime: WORKSPACE_MEMBERS_STALE_TIME,
    }),
  ])
}
