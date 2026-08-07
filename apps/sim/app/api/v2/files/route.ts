import {
  type V2File,
  v2CreateFileContract,
  v2ListFilesContract,
} from '@/lib/api/contracts/v2/files'
import { messageForOrchestrationError } from '@/lib/core/orchestration/types'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { queryWorkspaceFiles } from '@/lib/uploads/contexts/workspace'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import {
  MAX_WORKSPACE_FILE_INLINE_BODY_BYTES,
  performCreateWorkspaceFile,
} from '@/lib/workspace-files/orchestration'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2File, toV2Files } from '@/app/api/v2/files/utils'
import { resolveFolderPathId } from '@/app/api/v2/lib/folders'
import {
  cursorSortKey,
  decodeSortedCursor,
  encodeSortedCursor,
  v2CaughtOrchestrationError,
  v2CursorList,
  v2CursorSortError,
  v2Data,
  v2Error,
  v2ErrorForOrchestration,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/files — List files in a workspace with search, sort, and cursor
 * pagination.
 *
 * Filtering, ordering, and the page slice all run inside
 * {@link queryWorkspaceFiles}' query. The route only translates the validated
 * params and the opaque cursor, so a `search` never costs a full-workspace read.
 */
export const GET = withPublicApiRouteHandler({
  contract: v2ListFilesContract,
  rateLimitEndpoint: 'files',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    try {
      const { workspaceId, folderPath, search, sortBy, sortOrder, limit, cursor } = input.query

      const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
      if (access) return v2WorkspaceAccessError(access)

      const folderIndex = await loadActiveFolderPathIndex(workspaceId, 'file')
      const folderId =
        folderPath === undefined ? undefined : resolveFolderPathId(folderIndex, folderPath)
      if (folderPath !== undefined && folderId === undefined) {
        return v2Error('NOT_FOUND', 'Folder not found')
      }

      const sort = cursorSortKey(sortBy, sortOrder)
      const decoded = decodeSortedCursor(cursor, sort)
      if (decoded.status === 'invalid') return v2CursorSortError()

      const { files, nextKeys } = await queryWorkspaceFiles(workspaceId, {
        folderId,
        search,
        sortBy,
        sortOrder,
        limit,
        after: decoded.status === 'ok' ? decoded.keys : undefined,
      })

      const items: V2File[] = await toV2Files(files)
      const nextCursor = nextKeys ? encodeSortedCursor(sort, nextKeys) : null

      return v2CursorList(items, nextCursor, { rateLimit })
    } catch (error) {
      // A cursor that doesn't fit the requested sort arrives classified as `validation` → 400.
      const classified = v2CaughtOrchestrationError(error)
      if (classified) return classified

      throw error
    }
  },
})

/** POST /api/v2/files — Create an authored workspace file, optionally with initial content. */
export const POST = withPublicApiRouteHandler({
  contract: v2CreateFileContract,
  rateLimitEndpoint: 'files',
  parseOptions: {
    invalidJsonResponse: () => v2Error('BAD_REQUEST', 'Request body must be valid JSON'),
    maxBodyBytes: MAX_WORKSPACE_FILE_INLINE_BODY_BYTES,
    payloadTooLargeResponse: () => v2Error('PAYLOAD_TOO_LARGE', 'Request body is too large'),
  },
  handler: async ({ request, input, auth: { userId, rateLimit } }) => {
    const { workspaceId, name, contentType, folderPath, content, encoding } = input.body
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performCreateWorkspaceFile({
      workspaceId,
      userId,
      name,
      contentType: contentType ?? getMimeTypeFromExtension(getFileExtension(name)),
      folderPath: folderPath ?? '/',
      content: Buffer.from(content, encoding),
      exactName: true,
      request,
    })
    if (!result.success || !result.file) {
      return v2ErrorForOrchestration(
        result.errorCode,
        messageForOrchestrationError(result, 'Failed to create file')
      )
    }

    return v2Data(await toV2File(result.file), { rateLimit, status: 201 })
  },
})
