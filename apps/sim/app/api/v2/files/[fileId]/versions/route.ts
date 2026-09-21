import { v2ListFileVersionsContract } from '@/lib/api/contracts/v2/file-versions'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { listWorkspaceFileVersions } from '@/lib/workspace-files/application/file-versions'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { toV2FileVersions } from '@/app/api/v2/files/utils'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Binds a cursor to the file whose history it pages. Version numbers restart at 1 per file, so an
 * unbound cursor would resume another file's history at the same number.
 */
function versionCursorFilters(fileId: string) {
  return cursorScopeKey(cursorRoute(v2ListFileVersionsContract, { fileId }))
}

/** GET /api/v2/files/[fileId]/versions — List a file's versions, newest first by default. */
export const GET = defineV2JsonRoute({
  contract: v2ListFileVersionsContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.listVersions,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.concealResourceAuthorization,
  mapInput: ({ params, query }) => ({
    fileId: params.fileId,
    assertedWorkspaceId: query.workspaceId,
    sortOrder: query.sortOrder,
    limit: query.limit,
    after: readSortedCursor(
      query.cursor,
      query.sortBy,
      query.sortOrder,
      versionCursorFilters(params.fileId)
    ),
  }),
  useCase: listWorkspaceFileVersions,
  present: async ({ versions, nextKeys }, { params, query }) => ({
    data: await toV2FileVersions(versions),
    nextCursor: writeSortedCursor(
      nextKeys,
      query.sortBy,
      query.sortOrder,
      versionCursorFilters(params.fileId)
    ),
  }),
})
