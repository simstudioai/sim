import type { QueryClient } from '@tanstack/react-query'
import { listKnowledgeBasesContract } from '@/lib/api/contracts/knowledge'
import { internalSessionAuth } from '@/lib/api/server/routes'
import { internalKnowledgePresenters } from '@/lib/knowledge/api/internal-route'
import { listInternalKnowledgeBases } from '@/lib/knowledge/application/knowledge-bases'
import { getWorkspaceHostContextForViewer } from '@/lib/workspaces/host-context'
import { seedWorkspaceFiles } from '@/app/workspace/[workspaceId]/lib/seed-workspace-files'
import { KNOWLEDGE_BASE_LIST_STALE_TIME, knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'

/**
 * Prefetches what the Home surface needs on top of the workspace layout's own prefetch.
 *
 * Home reads the workspace file list on mount (resource tabs, mentions, the resource picker), so
 * the list is seeded by the routes that render Home rather than by the layout: seeding it in the
 * layout would pay for it on every workspace route, including the ones that never read it. The
 * knowledge-base list is seeded the same way, under the client hook's key and stale time: an
 * Assistant turn attaches the searched bases at submit, and a first question typed before the
 * list arrived would otherwise go out with nothing to search.
 *
 * The seed carries no authorization of its own, so the viewer is proved first. This reuses the
 * layout's `cache`d host-context lookup rather than re-deriving the permission, so it costs no
 * additional queries; a viewer without access caches nothing and the client fetch reaches the
 * route for the real 403.
 */
export async function prefetchHomeSurface(
  queryClient: QueryClient,
  workspaceId: string,
  userId: string | undefined
): Promise<void> {
  if (!userId) return
  const hostContext = await getWorkspaceHostContextForViewer(workspaceId, userId)
  if (!hostContext) return

  await Promise.all([
    seedWorkspaceFiles(queryClient, workspaceId),
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
  ])
}
