import type { QueryClient } from '@tanstack/react-query'
import { listFoldersForWorkspace } from '@/lib/folders/queries'
import { listKnowledgeBasesForViewer } from '@/lib/knowledge/queries'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'
import { prefetchResourceListChrome } from '@/app/workspace/[workspaceId]/lib/prefetch-resource-list-chrome'
import { FOLDER_LIST_STALE_TIME, folderKeys, mapFolder } from '@/hooks/queries/utils/folder-keys'
import { KNOWLEDGE_BASE_LIST_STALE_TIME, knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'

/**
 * Prefetches the workspace's knowledge-bases list AND its knowledge-base folder tree — plus
 * the pinned ids and members {@link prefetchResourceListChrome} covers — under
 * the same query keys the client `useKnowledgeBasesQuery` / `useFolders` hooks use (scope
 * `active`), so the list paints populated on first render.
 *
 * Both are needed: a base row is only placed correctly relative to the folder rows it sits
 * beside, so prefetching one without the other still flashes an ungrouped list — and a
 * `?folderId=` deep link renders an empty breadcrumb until the folders arrive.
 *
 * `listKnowledgeBasesForViewer` is viewer-scoped and returns the contract's wire shape,
 * and folders go through the same `mapFolder` the hook applies — so both hydrated
 * entries match a client fetch exactly.
 */
export async function prefetchKnowledgeBases(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string
): Promise<void> {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  if (!permission) return

  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: knowledgeKeys.list(workspaceId, 'active'),
      queryFn: () => listKnowledgeBasesForViewer(userId, workspaceId, 'active'),
      staleTime: KNOWLEDGE_BASE_LIST_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      queryKey: folderKeys.list(workspaceId, 'active', 'knowledge_base'),
      queryFn: async () => {
        const folders = await listFoldersForWorkspace(workspaceId, 'active', 'knowledge_base')
        return folders.map(mapFolder)
      },
      staleTime: FOLDER_LIST_STALE_TIME,
    }),
    prefetchResourceListChrome(queryClient, workspaceId, userId, 'knowledge_base'),
  ])
}
