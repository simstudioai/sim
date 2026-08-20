import { v2ListArchivedKnowledgeBasesContract } from '@/lib/api/contracts/v2/knowledge'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  defineV2JsonRoute,
  v2ApiKeyAuth,
  v2OrchestrationErrorPolicy,
  v2RateLimits,
} from '@/lib/api/server/routes'
import { listArchivedKnowledgeBases } from '@/lib/knowledge/application/knowledge-bases'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { toV2ArchivedKnowledgeBases } from '@/app/api/v2/knowledge/utils'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Every param that changes which archived knowledge bases, in which order, this list returns. */
function archivedKnowledgeCursorFilters(query: { workspaceId: string; search?: string }) {
  return cursorScopeKey(cursorRoute(v2ListArchivedKnowledgeBasesContract), {
    workspaceId: query.workspaceId,
    search: query.search,
  })
}

/**
 * GET /api/v2/knowledge/archived — List soft-deleted knowledge bases.
 *
 * A sibling path rather than a `scope` param on `GET /api/v2/knowledge`: the two
 * reads bind different semantic operations, and a v2 route declares exactly one.
 * Restore a listed base with `POST /api/v2/knowledge/{id}/restore`.
 */
export const GET = defineV2JsonRoute({
  contract: v2ListArchivedKnowledgeBasesContract,
  auth: v2ApiKeyAuth,
  operation: knowledgeOperations.listArchived,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2OrchestrationErrorPolicy,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    search: query.search,
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: query.limit,
    cursorKeys: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      archivedKnowledgeCursorFilters(query)
    ),
  }),
  useCase: listArchivedKnowledgeBases,
  present: async ({ knowledgeBases, nextCursorKeys }, { query }) => ({
    data: await toV2ArchivedKnowledgeBases(knowledgeBases),
    nextCursor: writeSortedCursor(
      nextCursorKeys,
      query.sortBy,
      query.sortOrder,
      archivedKnowledgeCursorFilters(query)
    ),
  }),
})
