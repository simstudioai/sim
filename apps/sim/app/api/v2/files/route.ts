import {
  type V2File,
  v2CreateFileContract,
  v2ListFilesContract,
} from '@/lib/api/contracts/v2/files'
import { INVALID_CURSOR_MESSAGE } from '@/lib/api/list-query'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import { v2FileErrorPolicies } from '@/lib/workspace-files/api'
import { createWorkspaceFile } from '@/lib/workspace-files/application/create-workspace-file'
import { queryWorkspaceFilePage } from '@/lib/workspace-files/application/list-workspace-files'
import { fileOperations } from '@/lib/workspace-files/application/operations'
import { MAX_WORKSPACE_FILE_INLINE_BODY_BYTES } from '@/lib/workspace-files/orchestration'
import { toV2File, toV2Files } from '@/app/api/v2/files/utils'
import {
  cursorSortKey,
  decodeSortedCursor,
  encodeSortedCursor,
  v2Error,
} from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/files — List files with search, sort, and cursor pagination. */
export const GET = defineV2JsonRoute({
  contract: v2ListFilesContract,
  auth: v2ApiKeyAuth,
  operation: fileOperations.list,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2FileErrorPolicies.default,
  mapInput: ({ query }) => {
    const cursorSort = cursorSortKey(query.sortBy, query.sortOrder)
    const decoded = decodeSortedCursor(query.cursor, cursorSort)
    if (decoded.status === 'invalid') {
      throw new OrchestrationError('validation', INVALID_CURSOR_MESSAGE)
    }
    return {
      workspaceId: query.workspaceId,
      folderPath: query.folderPath,
      search: query.search,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      limit: query.limit,
      after: decoded.status === 'ok' ? decoded.keys : undefined,
      cursorSort,
    }
  },
  useCase: queryWorkspaceFilePage,
  present: async ({ files, nextKeys, cursorSort }) => {
    const items: V2File[] = await toV2Files(files)
    return { data: items, nextCursor: nextKeys ? encodeSortedCursor(cursorSort, nextKeys) : null }
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
    invalidJsonResponse: () => v2Error('BAD_REQUEST', 'Request body must be valid JSON'),
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
