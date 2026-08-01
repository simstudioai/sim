import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2GetFileShareContract, v2UpsertFileShareContract } from '@/lib/api/contracts/v2/files'
import { parseRequest } from '@/lib/api/server'
import { messageForOrchestrationError } from '@/lib/core/orchestration/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  performGetWorkspaceFileShare,
  performUpsertWorkspaceFileShare,
} from '@/lib/workspace-files/orchestration'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2Data,
  v2Error,
  v2ErrorForOrchestration,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2FileShareAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

interface FileRouteParams {
  params: Promise<{ fileId: string }>
}

/**
 * GET /api/v2/files/[fileId]/share — Read a file's public share state.
 *
 * `null` means the file has never been shared. `hasPassword` is the only signal
 * carried for a password-gated share; the ciphertext is never exposed.
 */
export const GET = withRouteHandler(async (request: NextRequest, context: FileRouteParams) => {
  try {
    const rateLimit = await checkRateLimit(request, 'file-share')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2GetFileShareContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { fileId } = parsed.data.params
    const { workspaceId } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performGetWorkspaceFileShare({ workspaceId, fileId })

    if (!result.success) {
      return v2ErrorForOrchestration(
        result.errorCode,
        messageForOrchestrationError(result, 'Failed to fetch share')
      )
    }

    return v2Data({ share: result.share ?? null }, { rateLimit })
  } catch (error) {
    logger.error('Error fetching file share', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/**
 * PUT /api/v2/files/[fileId]/share — Enable or disable a file's public share.
 *
 * Requires workspace `write`, matching the UI. The share token is always
 * server-generated: the internal surface accepts a caller-supplied one so the UI
 * can render a link before saving, but over an API key that would mint
 * predictable public URLs and collide with the token unique index.
 *
 * `isActive: false` disables, it does not revoke — the token and the stored
 * password / allow-list survive, so re-enabling resurrects the same URL.
 */
export const PUT = withRouteHandler(async (request: NextRequest, context: FileRouteParams) => {
  try {
    const rateLimit = await checkRateLimit(request, 'file-share')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(v2UpsertFileShareContract, request, context, {
      validationErrorResponse: v2ValidationError,
    })
    if (!parsed.success) return parsed.response

    const { fileId } = parsed.data.params
    const { workspaceId, isActive, authType, password, allowedEmails } = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performUpsertWorkspaceFileShare({
      workspaceId,
      fileId,
      userId,
      isActive,
      authType,
      password,
      allowedEmails,
      request,
    })

    if (!result.success || !result.share) {
      return v2ErrorForOrchestration(
        result.errorCode,
        messageForOrchestrationError(result, 'Failed to update share')
      )
    }

    return v2Data({ share: result.share }, { rateLimit })
  } catch (error) {
    logger.error('Error updating file share', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
