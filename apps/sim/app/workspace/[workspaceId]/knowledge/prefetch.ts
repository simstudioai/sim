import type { QueryClient } from '@tanstack/react-query'
import type { FolderApi } from '@/lib/api/contracts/folders'
import type { KnowledgeBaseData } from '@/lib/api/contracts/knowledge'
import { prefetchInternalJson } from '@/app/workspace/[workspaceId]/lib/prefetch-internal-fetch'
import { FOLDER_LIST_STALE_TIME, mapFolder } from '@/hooks/queries/folders'
import { KNOWLEDGE_BASE_LIST_STALE_TIME } from '@/hooks/queries/kb/knowledge'
import { folderKeys } from '@/hooks/queries/utils/folder-keys'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'

/**
 * Prefetches the workspace's knowledge-bases list AND its knowledge-base folder tree under
 * the same query keys the client `useKnowledgeBasesQuery` / `useFolders` hooks use (scope
 * `active`), so the list paints populated on first render.
 *
 * Both are needed: a base row is only placed correctly relative to the folder rows it sits
 * beside, so prefetching one without the other still flashes an ungrouped list — and a
 * `?folderId=` deep link renders an empty breadcrumb until the folders arrive.
 *
 * The list carries `Date` fields, so it goes through the `/api/knowledge` route and caches the
 * serialized wire shape — see {@link prefetchInternalJson}. Folders are mapped with the same
 * `mapFolder` the hook applies, so the hydrated entry matches a client fetch exactly.
 */
export async function prefetchKnowledgeBases(
  queryClient: QueryClient,
  workspaceId: string
): Promise<void> {
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: knowledgeKeys.list(workspaceId, 'active'),
      queryFn: async () => {
        const result = await prefetchInternalJson<{ data: KnowledgeBaseData[] }>(
          `/api/knowledge?workspaceId=${workspaceId}&scope=active`
        )
        return result.data
      },
      staleTime: KNOWLEDGE_BASE_LIST_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      queryKey: folderKeys.list(workspaceId, 'active', 'knowledge_base'),
      queryFn: async () => {
        const { folders } = await prefetchInternalJson<{ folders?: FolderApi[] }>(
          `/api/folders?workspaceId=${workspaceId}&scope=active&resourceType=knowledge_base`
        )
        return (folders ?? []).map(mapFolder)
      },
      staleTime: FOLDER_LIST_STALE_TIME,
    }),
  ])
}
