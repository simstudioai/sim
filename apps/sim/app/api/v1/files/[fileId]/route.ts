import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { v1DeleteFileContract, v1DownloadFileContract } from '@/lib/api/contracts/v1/files'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  deleteWorkspaceFile,
  fetchWorkspaceFileBuffer,
  getWorkspaceFile,
} from '@/lib/uploads/contexts/workspace'
import {
  checkRateLimit,
  createRateLimitResponse,
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
    const parsed = await parseRequest(v1DownloadFileContract, request, context)
    if (!parsed.success) return parsed.response

    const { fileId } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const accessError = await validateWorkspaceAccess(rateLimit, userId, workspaceId)
    if (accessError) return accessError

    const fileRecord = await getWorkspaceFile(workspaceId, fileId)
    if (!fileRecord) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const buffer = await fetchWorkspaceFileBuffer(fileRecord)

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': fileRecord.type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileRecord.name.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileRecord.name)}`,
        'Content-Length': String(buffer.length),
        'X-File-Id': fileRecord.id,
        'X-File-Name': encodeURIComponent(fileRecord.name),
        'X-Uploaded-At':
          fileRecord.uploadedAt instanceof Date
            ? fileRecord.uploadedAt.toISOString()
            : String(fileRecord.uploadedAt),
      },
    })
  } catch (error) {
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
    const parsed = await parseRequest(v1DeleteFileContract, request, context)
    if (!parsed.success) return parsed.response

    const { fileId } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const accessError = await validateWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (accessError) return accessError

    const fileRecord = await getWorkspaceFile(workspaceId, fileId)
    if (!fileRecord) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    await deleteWorkspaceFile(workspaceId, fileId)

    logger.info(
      `[${requestId}] Archived file: ${fileRecord.name} (${fileId}) from workspace ${workspaceId}`
    )

    recordAudit({
      workspaceId,
      actorId: userId,
      action: AuditAction.FILE_DELETED,
      resourceType: AuditResourceType.FILE,
      resourceId: fileId,
      resourceName: fileRecord.name,
      description: `Archived file "${fileRecord.name}" via API`,
      metadata: { fileSize: fileRecord.size, fileType: fileRecord.type },
      request,
    })

    return NextResponse.json({
      success: true,
      data: {
        message: 'File archived successfully',
      },
    })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting file:`, error)
    return NextResponse.json({ error: 'Failed to delete file' }, { status: 500 })
  }
})
