import type { QueryClient } from '@tanstack/react-query'
import type { KnowledgeBaseData } from '@/lib/api/contracts/knowledge'
import { prefetchInternalJson } from '@/app/workspace/[workspaceId]/lib/prefetch-internal-fetch'
import { KNOWLEDGE_BASE_LIST_STALE_TIME, knowledgeKeys } from '@/hooks/queries/kb/knowledge'

/**
 * Prefetches the workspace's knowledge-bases list under the same query key the
 * client `useKnowledgeBasesQuery` hook uses (scope `active`), so the list paints
 * populated on first render.
 *
 * The list carries `Date` fields, so it goes through the `/api/knowledge` route
 * and caches the serialized wire shape — see {@link prefetchInternalJson}.
 */
export async function prefetchKnowledgeBases(
  queryClient: QueryClient,
  workspaceId: string
): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey: knowledgeKeys.list(workspaceId, 'active'),
    queryFn: async () => {
      const result = await prefetchInternalJson<{ data: KnowledgeBaseData[] }>(
        `/api/knowledge?workspaceId=${workspaceId}&scope=active`
      )
      return result.data
    },
    staleTime: KNOWLEDGE_BASE_LIST_STALE_TIME,
  })
}
