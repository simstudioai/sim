import type { QueryClient } from '@tanstack/react-query'
import { listKnowledgeBasesContract } from '@/lib/api/contracts/knowledge'
import { internalSessionAuth } from '@/lib/api/server/routes'
import { internalKnowledgePresenters } from '@/lib/knowledge/api/internal-route'
import { listInternalKnowledgeBases } from '@/lib/knowledge/application/knowledge-bases'
import { prefetchResourceFolders } from '@/app/workspace/[workspaceId]/lib/prefetch-resource-folders'
import { prefetchResourceListChrome } from '@/app/workspace/[workspaceId]/lib/prefetch-resource-list-chrome'
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
 * The bases list runs the same `listInternalKnowledgeBases` application use case
 * `GET /api/knowledge` runs, authenticated with the same `internalSessionAuth` policy, and is
 * projected through the same `internalKnowledgePresenters.list` presenter and the contract's
 * response schema. Nothing about authorization moves here: the use case still loads the
 * canonical workspace context and authorizes the session principal against
 * `knowledgeOperations.list`. An unauthenticated or unauthorized viewer throws inside the
 * query function, which caches nothing and leaves the client fetch to reach the route for the
 * real 401/403.
 *
 * Folders read the data layer and are mapped with the same `mapFolder` the hook applies,
 * matching the workspace sidebar prefetch. That read carries no authorization of its own, so
 * the viewer is proved first; `getWorkspaceHostContextForViewer` is `cache`d and the layout has
 * already resolved it for this request, so it costs no additional queries.
 */
export async function prefetchKnowledgeBases(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string | undefined
): Promise<void> {
  if (!userId) return

  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: knowledgeKeys.list(workspaceId, 'active'),
      queryFn: async () => {
        const principal = await internalSessionAuth.authenticate()
        const result = await listInternalKnowledgeBases.execute({
          principal,
          input: { workspaceId, scope: 'active' },
        })
        return listKnowledgeBasesContract.response.schema.parse(
          internalKnowledgePresenters.list(result)
        ).data
      },
      staleTime: KNOWLEDGE_BASE_LIST_STALE_TIME,
    }),
    prefetchResourceFolders(queryClient, workspaceId, 'knowledge_base', userId),
    prefetchResourceListChrome(queryClient, workspaceId, 'knowledge_base', userId),
  ])
}
