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
  FileConflictError,
  getWorkspaceFile,
  listWorkspaceFiles,
  uploadWorkspaceFile,
} from '@/lib/uploads/contexts/workspace'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import {
  decodeCursor,
  encodeCursor,
  v2CursorList,
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

interface FileCursor {
  uploadedAt: string
  id: string
}

/** Stable keyset ordering: `uploadedAt` ascending, `id` ascending as the tiebreaker. */
function compareFiles(a: V2File, b: V2File): number {
  if (a.uploadedAt !== b.uploadedAt) return a.uploadedAt < b.uploadedAt ? -1 : 1
  if (a.id !== b.id) return a.id < b.id ? -1 : 1
  return 0
}

/**
 * GET /api/v2/files — List files in a workspace with cursor pagination.
 *
 * The shared {@link listWorkspaceFiles} manager returns the full active set
 * ordered by `uploadedAt`; v2 applies a bounded keyset slice over that result in
 * the route. Pushing `limit`/`cursor` down into the manager query is a follow-up.
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const rateLimit = await checkRateLimit(request, 'files')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const parsed = await parseRequest(
      v2ListFilesContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, limit, cursor } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const files = await listWorkspaceFiles(workspaceId)

    const items: V2File[] = files
      .map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        type: f.type,
        key: f.key,
        uploadedBy: f.uploadedBy,
        uploadedAt:
          f.uploadedAt instanceof Date ? f.uploadedAt.toISOString() : String(f.uploadedAt),
      }))
      .sort(compareFiles)

    const decoded = cursor ? decodeCursor<FileCursor>(cursor) : null
    const afterCursor = decoded
      ? items.filter(
          (f) =>
            f.uploadedAt > decoded.uploadedAt ||
            (f.uploadedAt === decoded.uploadedAt && f.id > decoded.id)
        )
      : items

    const hasMore = afterCursor.length > limit
    const page = afterCursor.slice(0, limit)
    const last = page.at(-1)
    const nextCursor =
      hasMore && last ? encodeCursor({ uploadedAt: last.uploadedAt, id: last.id }) : null

    return v2CursorList(page, nextCursor, { rateLimit })
  } catch (error) {
    logger.error('Error listing files', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/**
 * POST /api/v2/files — Upload a file to a workspace.
 *
 * Authorization runs fully (rate limit → workspace write access) before the
 * multipart body is buffered: the workspace is a contract-validated query param,
 * so an unauthorized caller never streams a 100 MB body into memory.
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  try {
    const rateLimit = await checkRateLimit(request, 'files')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const parsed = await parseRequest(
      v2UploadFileContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId } = parsed.data.query

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
      file.type || 'application/octet-stream'
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

    const fileRecord = await getWorkspaceFile(workspaceId, userFile.id)
    const uploadedAt =
      fileRecord?.uploadedAt instanceof Date
        ? fileRecord.uploadedAt.toISOString()
        : fileRecord?.uploadedAt
          ? String(fileRecord.uploadedAt)
          : new Date().toISOString()

    const responseFile: V2File = {
      id: userFile.id,
      name: userFile.name,
      size: userFile.size,
      type: userFile.type,
      key: userFile.key,
      uploadedBy: userId,
      uploadedAt,
    }

    return v2Data(responseFile, { rateLimit, status: 201 })
  } catch (error) {
    if (isPayloadSizeLimitError(error)) {
      return v2Error('PAYLOAD_TOO_LARGE', error.message)
    }

    const message = getErrorMessage(error, 'Failed to upload file')
    if (error instanceof FileConflictError || message.includes('already exists')) {
      return v2Error('CONFLICT', message)
    }
    if (message.includes('Storage limit') || message.includes('storage limit')) {
      return v2Error('PAYLOAD_TOO_LARGE', 'Storage limit exceeded')
    }

    logger.error('Error uploading file', { error: message })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
