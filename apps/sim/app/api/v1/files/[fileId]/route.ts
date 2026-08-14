import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { v1DeleteFileContract, v1DownloadFileContract } from '@/lib/api/contracts/v1/files'
import { parseRequest } from '@/lib/api/server'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { captureServerEvent } from '@/lib/posthog/server'
import { getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { downloadWorkspaceFileStream } from '@/lib/workspace-files/application/download-workspace-file'
import { performDeleteWorkspaceFileItems } from '@/lib/workspace-files/orchestration'
import {
  checkRateLimit,
  createRateLimitResponse,
  requireRateLimitPrincipal,
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

    const parsed = await parseRequest(v1DownloadFileContract, request, context, {
      validationErrorResponse: v1ValidationErrorResponse,
    })
    if (!parsed.success) return parsed.response

    const { fileId } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const principal = requireRateLimitPrincipal(rateLimit)
    const { file, stream, contentLength, contentType } = await downloadWorkspaceFileStream.execute({
      principal,
      input: { fileId, assertedWorkspaceId: workspaceId },
      request,
    })
    if (principal.kind === 'personal_api_key') {
      captureServerEvent(
        principal.userId,
        'file_downloaded',
        { workspace_id: workspaceId, is_bulk: false, file_count: 1 },
        { groups: { workspace: workspaceId } }
      )
    }

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': contentType || file.type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${file.name.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'Content-Length': String(contentLength),
        'X-File-Id': file.id,
        'X-File-Name': encodeURIComponent(file.name),
        'X-Uploaded-At':
          file.uploadedAt instanceof Date ? file.uploadedAt.toISOString() : String(file.uploadedAt),
      },
    })
  } catch (error) {
    const orchestrationError = asOrchestrationError(error)
    if (orchestrationError && orchestrationError.code !== 'internal') {
      return NextResponse.json(
        {
          error:
            orchestrationError.code === 'not_found' ? 'File not found' : orchestrationError.message,
        },
        { status: statusForOrchestrationError(orchestrationError.code) }
      )
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
