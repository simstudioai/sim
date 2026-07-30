import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2DeleteFileContract, v2DownloadFileContract } from '@/lib/api/contracts/v2/files'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { fetchWorkspaceFileBuffer, getWorkspaceFile } from '@/lib/uploads/contexts/workspace'
import { performDeleteWorkspaceFileItems } from '@/lib/workspace-files/orchestration'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import type { V2ErrorCode } from '@/app/api/v2/lib/response'
import {
  rateLimitHeaders,
  v2Data,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2FileDetailAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface FileRouteParams {
  params: Promise<{ fileId: string }>
}

/**
 * GET /api/v2/files/[fileId] — Download file content (binary).
 *
 * The response carries no JSON envelope, so rate-limit state is surfaced via
 * `X-RateLimit-*` headers. Errors still render the canonical v2 JSON error body.
 * Lookups are workspace-scoped (IDOR-safe): a file in another workspace 404s.
 */
export const GET = withRouteHandler(async (request: NextRequest, context: FileRouteParams) => {
  try {
    const rateLimit = await checkRateLimit(request, 'file-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const parsed = await parseRequest(v2DownloadFileContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { fileId } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const fileRecord = await getWorkspaceFile(workspaceId, fileId)
    if (!fileRecord) return v2Error('NOT_FOUND', 'File not found')

    const buffer = await fetchWorkspaceFileBuffer(fileRecord)

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': fileRecord.type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileRecord.name.replace(/[^\w.-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileRecord.name)}`,
        'Content-Length': String(buffer.length),
        ...rateLimitHeaders(rateLimit),
      },
    })
  } catch (error) {
    logger.error('Error downloading file', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/**
 * DELETE /api/v2/files/[fileId] — Archive (soft delete) a file.
 *
 * Delegates to the shared orchestration, which is workspace-scoped and records
 * its own audit entry (the request is forwarded so that entry captures client
 * IP / user agent). Orchestration `errorCode`s map to specific v2 codes rather
 * than v1's blanket 500.
 */
export const DELETE = withRouteHandler(async (request: NextRequest, context: FileRouteParams) => {
  try {
    const rateLimit = await checkRateLimit(request, 'file-detail')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const parsed = await parseRequest(v2DeleteFileContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { fileId } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performDeleteWorkspaceFileItems({
      workspaceId,
      userId,
      fileIds: [fileId],
      request,
    })

    if (!result.success) {
      const code: V2ErrorCode =
        result.errorCode === 'not_found'
          ? 'NOT_FOUND'
          : result.errorCode === 'validation'
            ? 'BAD_REQUEST'
            : result.errorCode === 'conflict'
              ? 'CONFLICT'
              : 'INTERNAL_ERROR'
      return v2Error(code, result.error || 'Failed to delete file')
    }

    logger.info(`Archived file ${fileId} from workspace ${workspaceId}`)

    return v2Data({ id: fileId, deleted: true as const }, { rateLimit })
  } catch (error) {
    logger.error('Error deleting file', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
