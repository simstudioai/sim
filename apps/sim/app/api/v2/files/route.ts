import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  type V2File,
  v2ListFilesContract,
  v2UploadFileContract,
} from '@/lib/api/contracts/v2/files'
import { parseRequest } from '@/lib/api/server'
import {
  isPayloadSizeLimitError,
  readFileToBufferWithLimit,
  readFormDataWithLimit,
} from '@/lib/core/utils/stream-limits'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  getWorkspaceFile,
  queryWorkspaceFiles,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2File } from '@/app/api/v2/files/utils'
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
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2FilesAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MAX_FILE_SIZE = 100 * 1024 * 1024
const MAX_MULTIPART_OVERHEAD_BYTES = 1024 * 1024

/**
 * GET /api/v2/files — List files in a workspace with search, sort, and cursor
 * pagination.
 *
 * `scope=archived` reads Recently Deleted, which is what makes the restore
 * endpoints usable — a caller can find the id of something it deleted.
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

    const { workspaceId, scope, folderId, search, sortBy, sortOrder, limit, cursor } =
      parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const sort = cursorSortKey(sortBy, sortOrder)
    const decoded = decodeSortedCursor(cursor, sort)
    if (decoded.status === 'invalid') return v2CursorSortError()

    const { files, nextKeys } = await queryWorkspaceFiles(workspaceId, {
      scope,
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

/**
 * POST /api/v2/files — Upload a file to a workspace.
 *
 * Authorization runs fully (rate limit → workspace write access) before the
 * multipart body is buffered: the workspace and the optional target `folderId`
 * are contract-validated query params, so an unauthorized caller never streams a
 * 100 MB body into memory.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const rateLimit = await checkRateLimit(request, 'files')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2UploadFileContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, folderId } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    let formData: FormData
    try {
      formData = await readFormDataWithLimit(request, {
        maxBytes: MAX_FILE_SIZE + MAX_MULTIPART_OVERHEAD_BYTES,
        label: 'workspace file upload body',
      })
    } catch (error) {
      if (isPayloadSizeLimitError(error)) {
        return v2Error('PAYLOAD_TOO_LARGE', error.message)
      }
      return v2Error('BAD_REQUEST', 'Request body must be valid multipart form data')
    }

    const rawFile = formData.get('file')
    const file = rawFile instanceof File ? rawFile : null
    if (!file) {
      return v2Error('BAD_REQUEST', 'file form field is required')
    }

    if (file.size > MAX_FILE_SIZE) {
      return v2Error(
        'PAYLOAD_TOO_LARGE',
        `File size exceeds 100MB limit (${(file.size / (1024 * 1024)).toFixed(2)}MB)`
      )
    }

    const buffer = await readFileToBufferWithLimit(file, {
      maxBytes: MAX_FILE_SIZE,
      label: 'workspace upload file',
    })

    const userFile = await uploadWorkspaceFile(
      workspaceId,
      userId,
      buffer,
      file.name,
      file.type || 'application/octet-stream',
      { folderId: folderId ?? null }
    )

    logger.info(`Uploaded file: ${file.name} to workspace ${workspaceId}`)

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.FILE_UPLOADED,
      resourceType: AuditResourceType.FILE,
      resourceId: userFile.id,
      resourceName: file.name,
      description: `Uploaded file "${file.name}" via API`,
      metadata: { fileSize: file.size, fileType: file.type || 'application/octet-stream' },
      request,
    })

    /**
     * `uploadWorkspaceFile` returns the executor-facing `UserFile`, which carries
     * neither the folder path nor the persisted timestamps, so the stored record
     * is the source for the response projection.
     *
     * `throwOnError` matters here: by default this reader swallows a query
     * failure and returns `null`, which would make a transient blip on the read
     * indistinguishable from the row being gone. The row was committed by the
     * upload moments earlier on the same primary, so a genuine `null` is an
     * invariant break — worth a 500 — while a transient failure should surface
     * as itself rather than being reported as a missing file.
     */
    const fileRecord = await getWorkspaceFile(workspaceId, userFile.id, { throwOnError: true })
    if (!fileRecord) {
      throw new Error(`Uploaded file ${userFile.id} could not be read back`)
    }

    return v2Data(toV2File(fileRecord), { rateLimit, status: 201 })
  } catch (error) {
    if (isPayloadSizeLimitError(error)) {
      return v2Error('PAYLOAD_TOO_LARGE', error.message)
    }

    // Conflicts, a missing target folder, and a blown storage quota all arrive classified
    // now, so the status comes off the error's code rather than its wording.
    const classified = v2CaughtOrchestrationError(error)
    if (classified) return classified

    const message = getErrorMessage(error, 'Failed to upload file')
    logger.error('Error uploading file', { error: message })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
