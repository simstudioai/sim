import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  type V2File,
  v2CreateFileContract,
  v2ListFilesContract,
} from '@/lib/api/contracts/v2/files'
import { parseRequest } from '@/lib/api/server'
import { messageForOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { loadActiveFolderPathIndex } from '@/lib/folders/queries'
import { queryWorkspaceFiles } from '@/lib/uploads/contexts/workspace'
import { getFileExtension, getMimeTypeFromExtension } from '@/lib/uploads/utils/file-utils'
import {
  MAX_WORKSPACE_FILE_INLINE_BODY_BYTES,
  performCreateWorkspaceFile,
} from '@/lib/workspace-files/orchestration'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2File } from '@/app/api/v2/files/utils'
import { resolveFolderPathId } from '@/app/api/v2/lib/folders'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
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
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2FilesAPI')

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
export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const rateLimit = await checkRateLimit(request, 'files')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2ListFilesContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, folderPath, search, sortBy, sortOrder, limit, cursor } = parsed.data.query

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

    const items: V2File[] = files.map(toV2File)
    const nextCursor = nextKeys ? encodeSortedCursor(sort, nextKeys) : null

    return v2CursorList(items, nextCursor, { rateLimit })
  } catch (error) {
    // A cursor that doesn't fit the requested sort arrives classified as `validation` → 400.
    const classified = v2CaughtOrchestrationError(error)
    if (classified) return classified

    logger.error('Error listing files', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** POST /api/v2/files — Create an authored workspace file, optionally with initial content. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const rateLimit = await checkRateLimit(request, 'files')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2CreateFileContract,
      request,
      {},
      {
        invalidJsonResponse: () => v2Error('BAD_REQUEST', 'Request body must be valid JSON'),
        maxBodyBytes: MAX_WORKSPACE_FILE_INLINE_BODY_BYTES,
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) {
      return parsed.response.status === 413
        ? v2Error('PAYLOAD_TOO_LARGE', 'Request body is too large')
        : parsed.response
    }

    const { workspaceId, name, contentType, folderPath, content, encoding } = parsed.data.body
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const folderIndex = await loadActiveFolderPathIndex(workspaceId, 'file')
    const folderId = resolveFolderPathId(folderIndex, folderPath ?? '/')
    if (folderId === undefined) return v2Error('NOT_FOUND', 'Folder not found')

    const result = await performCreateWorkspaceFile({
      workspaceId,
      userId,
      name,
      contentType: contentType ?? getMimeTypeFromExtension(getFileExtension(name)),
      folderId,
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

    return v2Data(toV2File(result.file), { rateLimit, status: 201 })
  } catch (error) {
    logger.error('Error creating file', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
