import type { QueryClient } from '@tanstack/react-query'
import type { PinnedItemApi, PinnedResourceType } from '@/lib/api/contracts/pinned-items'
import { prefetchInternalJson } from '@/app/workspace/[workspaceId]/lib/prefetch-internal-fetch'
import { PINNED_ITEMS_STALE_TIME, pinnedItemKeys } from '@/hooks/queries/utils/pinned-item-keys'
import {
  WORKSPACE_MEMBERS_STALE_TIME,
  type WorkspaceMember,
  workspaceKeys,
} from '@/hooks/queries/workspace'

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
 */
export async function prefetchResourceListChrome(
  queryClient: QueryClient,
  workspaceId: string,
  resourceType: PinnedResourceType
): Promise<void> {
  const prefetchPinned = (type: PinnedResourceType) =>
    queryClient.prefetchQuery({
      queryKey: pinnedItemKeys.list(workspaceId, type),
      queryFn: async () => {
        const { pinnedItems } = await prefetchInternalJson<{ pinnedItems: PinnedItemApi[] }>(
          `/api/pinned-items?workspaceId=${workspaceId}&resourceType=${type}`
        )
        return pinnedItems
      },
      staleTime: PINNED_ITEMS_STALE_TIME,
    })

  await Promise.all([
    prefetchPinned(resourceType),
    prefetchPinned('folder'),
    queryClient.prefetchQuery({
      queryKey: workspaceKeys.members(workspaceId),
      queryFn: async () => {
        const { members } = await prefetchInternalJson<{ members: WorkspaceMember[] }>(
          `/api/workspaces/${workspaceId}/members`
        )
        return members
      },
      staleTime: WORKSPACE_MEMBERS_STALE_TIME,
    }),
  ])
}
