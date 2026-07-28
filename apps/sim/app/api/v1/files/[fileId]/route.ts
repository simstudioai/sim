import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { v1DeleteFileContract, v1DownloadFileContract } from '@/lib/api/contracts/v1/files'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  fetchServableWorkspaceFileBuffer,
  getWorkspaceFile,
} from '@/lib/uploads/contexts/workspace'
import { docNotReadyMessage, isDocNotReadyError } from '@/lib/uploads/utils/servable-file-response'
import { performDeleteWorkspaceFileItems } from '@/lib/workspace-files/orchestration'
import {
  checkRateLimit,
  createRateLimitResponse,
  rateLimitHeaders,
  v1ValidationErrorResponse,
  validateWorkspaceAccess,
} from '@/app/api/v1/middleware'

const logger = createLogger('V1FileDetailAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface FileRouteParams {
  params: Promise<{ fileId: string }>
}

/** GET /api/v1/files/[fileId] — Download file content. */
export const GET = withRouteHandler(async (request: NextRequest, context: FileRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'file-detail')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const parsed = await parseRequest(v1DownloadFileContract, request, context, {
      validationErrorResponse: v1ValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response

    const { fileId } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const accessError = await validateWorkspaceAccess(rateLimit, userId, workspaceId)
    if (accessError) return accessError

    const fileRecord = await getWorkspaceFile(workspaceId, fileId)
    if (!fileRecord) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    // Generated docs store their generation source; serve the rendered artifact.
    // Its content type is the rendered one, not the source MIME on the record.
    const { buffer, contentType } = await fetchServableWorkspaceFileBuffer(fileRecord)

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.FILE_DOWNLOADED,
      resourceType: AuditResourceType.FILE,
      resourceId: fileRecord.id,
      resourceName: fileRecord.name,
      description: `Downloaded file "${fileRecord.name}" via API`,
      metadata: {
        fileId: fileRecord.id,
        fileName: fileRecord.name,
        bytes: buffer.length,
        source: 'api_v1',
      },
      request,
    })
    captureServerEvent(
      userId,
      'file_downloaded',
      { workspace_id: workspaceId, is_bulk: false, file_count: 1 },
      { groups: { workspace: workspaceId } }
    )

    // View, not copy — a second full copy would double peak memory for a large file.
    return new Response(
      new Uint8Array(buffer.buffer as ArrayBuffer, buffer.byteOffset, buffer.byteLength),
      {
        status: 200,
        headers: {
          ...rateLimitHeaders(rateLimit),
          'Content-Type': contentType || fileRecord.type || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${fileRecord.name.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileRecord.name)}`,
          'Content-Length': String(buffer.length),
          'X-File-Id': fileRecord.id,
          'X-File-Name': encodeURIComponent(fileRecord.name),
          'X-Uploaded-At':
            fileRecord.uploadedAt instanceof Date
              ? fileRecord.uploadedAt.toISOString()
              : String(fileRecord.uploadedAt),
        },
      }
    )
  } catch (error) {
    // A generated doc whose artifact is still compiling is retryable, not a fault:
    // without this the caller sees a 500 and has no reason to try again.
    if (isDocNotReadyError(error)) {
      return NextResponse.json({ error: docNotReadyMessage() }, { status: 409 })
    }
    logger.error(`[${requestId}] Error downloading file:`, error)
    return NextResponse.json({ error: 'Failed to download file' }, { status: 500 })
  }
})

/** DELETE /api/v1/files/[fileId] — Archive a file. */
export const DELETE = withRouteHandler(async (request: NextRequest, context: FileRouteParams) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'file-detail')
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit)
    }

    const userId = rateLimit.userId!
    const parsed = await parseRequest(v1DeleteFileContract, request, context, {
      validationErrorResponse: v1ValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response

    const { fileId } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const accessError = await validateWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (accessError) return accessError

    const fileRecord = await getWorkspaceFile(workspaceId, fileId)
    if (!fileRecord) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const result = await performDeleteWorkspaceFileItems({
      workspaceId,
      userId,
      fileIds: [fileId],
    })
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    logger.info(
      `[${requestId}] Archived file: ${fileRecord.name} (${fileId}) from workspace ${workspaceId}`
    )

    return NextResponse.json(
      {
        success: true,
        data: {
          message: 'File archived successfully',
        },
      },
      { headers: rateLimitHeaders(rateLimit) }
    )
  } catch (error) {
    logger.error(`[${requestId}] Error deleting file:`, error)
    return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 })
  }
})
