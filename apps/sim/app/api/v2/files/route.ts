import {
  listsSubfolders,
  type V2File,
  v2CreateFileContract,
  v2ListFilesContract,
} from '@/lib/api/contracts/v2/files'
import { cursorRoute, cursorScopeKey } from '@/lib/api/cursor-binding'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { createWorkspaceFile } from '@/lib/workspace-files/application/create-workspace-file'
import { queryWorkspaceFilePage } from '@/lib/workspace-files/application/list-workspace-files'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { MAX_WORKSPACE_FILE_INLINE_BODY_BYTES } from '@/lib/workspace-files/orchestration'
import { toV2File, toV2Files } from '@/app/api/v2/files/utils'
import { readSortedCursor, writeSortedCursor } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Every param that changes which files, in which order, this list returns. */
function fileCursorFilters(query: {
  workspaceId: string
  scope?: string
  folderPath?: string
  search?: string
  recursive?: boolean
}) {
  return cursorScopeKey(cursorRoute(v2ListFilesContract), {
    workspaceId: query.workspaceId,
    scope: query.scope,
    folderPath: query.folderPath,
    search: query.search,
    /**
     * Keyed on the resolved value, not the raw parameter: omitting `recursive` beside a
     * search asks for the same page as sending `recursive=true`, so keying on the parameter
     * would reject a cursor between two requests that select identical rows.
     */
    recursive: String(listsSubfolders(query)),
  })
}

/** GET /api/v2/files — List files with search, sort, and cursor pagination. */
export const GET = defineV2JsonRoute({
  contract: v2ListFilesContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.list,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.default,
  mapInput: ({ query }) => ({
    workspaceId: query.workspaceId,
    scope: query.scope,
    folderPath: query.folderPath,
    search: query.search,
    recursive: listsSubfolders(query),
    sortBy: query.sortBy,
    sortOrder: query.sortOrder,
    limit: query.limit,
    after: readSortedCursor(query.cursor, query.sortBy, query.sortOrder, fileCursorFilters(query)),
  }),
  useCase: queryWorkspaceFilePage,
  present: async ({ files, nextKeys }, { query }) => {
    const items: V2File[] = await toV2Files(files)
    return {
      data: items,
      nextCursor: writeSortedCursor(
        nextKeys,
        query.sortBy,
        query.sortOrder,
        fileCursorFilters(query)
      ),
    }
  },
})

/** POST /api/v2/files — Create an authored workspace file. */
export const POST = defineV2JsonRoute({
  contract: v2CreateFileContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.create,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.default,
  parseOptions: {
    maxBodyBytes: MAX_WORKSPACE_FILE_INLINE_BODY_BYTES,
  },
  mapInput: ({ body }) => ({
    workspaceId: body.workspaceId,
    name: body.name,
    contentType: body.contentType ?? getMimeTypeFromExtension(getFileExtension(body.name)),
    content: body.content,
    encoding: body.encoding,
    folderPath: body.folderPath ?? '/',
    exactName: true,
  }),
  useCase: createWorkspaceFile,
  present: async ({ file }) => ({ data: await toV2File(file) }),
})
