import {
  createWorkspaceFileContract,
  DEFAULT_WORKSPACE_FILE_PAGE_SIZE,
  listWorkspaceFilesContract,
  WORKSPACE_FILE_PAGE_PARAMS,
} from '@/lib/api/contracts/workspace-files'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file'
import {
  internalFileAnalytics,
  internalFileErrorPolicies,
  internalFilePresenters,
} from '@/lib/workspace-files/api'
import {
  admitCreateWorkspaceFile,
  createWorkspaceFile,
} from '@/lib/workspace-files/application/create-workspace-file'
import { listWorkspaceFileCollection } from '@/lib/workspace-files/application/list-workspace-files'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { MAX_WORKSPACE_FILE_INLINE_BODY_BYTES } from '@/lib/workspace-files/orchestration'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'

/** The params besides the sort that change which files a page walk returns; the cursor is bound to them. */
function fileCursorFilters(
  workspaceId: string,
  query: { scope: 'active' | 'archived'; folderId?: string | null }
) {
  return cursorScopeKey(cursorRoute(listWorkspaceFilesContract, { id: workspaceId }), {
    scope: query.scope,
    folderId: query.folderId,
  })
}

/**
 * GET /api/workspaces/[id]/files — List workspace files: one bounded page with `nextCursor`
 * when any paging param is sent, else the whole scope.
 */
export const GET = defineInternalJsonRoute({
  contract: listWorkspaceFilesContract,
  auth: internalSessionAuth,
  operation: fileOperations.list,
  // One policy per route: paged requests share the unpaged list's exemption until the builder
  // can choose a policy per request.
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal file-list behavior' }),
  errorPolicy: internalFileErrorPolicies.default,
  mapInput: ({ params, query }) => {
    if (!WORKSPACE_FILE_PAGE_PARAMS.some((param) => query[param] !== undefined)) {
      return { workspaceId: params.id, scope: query.scope }
    }
    const sortBy = query.sortBy ?? 'uploadedAt'
    const sortOrder = query.sortOrder ?? 'asc'
    return {
      workspaceId: params.id,
      scope: query.scope,
      page: {
        folderId: query.folderId,
        sortBy,
        sortOrder,
        limit: query.limit ?? DEFAULT_WORKSPACE_FILE_PAGE_SIZE,
        after: readSortedCursor(
          query.cursor,
          sortBy,
          sortOrder,
          fileCursorFilters(params.id, query)
        ),
      },
    }
  },
  useCase: listWorkspaceFileCollection,
  present: (result, { input }) => {
    const listed = internalFilePresenters.successFiles(result)
    if (!input.page) return listed
    return {
      ...listed,
      nextCursor: writeSortedCursor(
        result.nextKeys,
        input.page.sortBy,
        input.page.sortOrder,
        fileCursorFilters(input.workspaceId, { scope: input.scope, folderId: input.page.folderId })
      ),
    }
  },
})

/** POST /api/workspaces/[id]/files — Create an authored workspace file. */
export const POST = defineInternalJsonRoute({
  contract: createWorkspaceFileContract,
  auth: internalSessionAuth,
  operation: fileOperations.create,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing internal file-create behavior' }),
  errorPolicy: internalFileErrorPolicies.default,
  parseOptions: { maxBodyBytes: MAX_WORKSPACE_FILE_INLINE_BODY_BYTES },
  beforeParse: async ({ principal, params }) => {
    if (typeof params.id === 'string') await admitCreateWorkspaceFile(principal, params.id)
  },
  mapInput: ({ params, body }) => ({
    workspaceId: params.id,
    name: body.name,
    contentType: body.contentType ?? getMimeTypeFromExtension(getFileExtension(body.name)),
    content: body.content,
    encoding: body.encoding,
    folderId: body.folderId,
    exactName: false,
  }),
  useCase: createWorkspaceFile,
  onSuccess: internalFileAnalytics.uploaded,
  present: internalFilePresenters.successFile,
})
