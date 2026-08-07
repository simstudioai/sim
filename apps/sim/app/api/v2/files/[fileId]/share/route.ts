import { v2GetFileShareContract, v2UpsertFileShareContract } from '@/lib/api/contracts/v2/files'
import { messageForOrchestrationError } from '@/lib/core/orchestration/types'
import {
  performGetWorkspaceFileShare,
  performUpsertWorkspaceFileShare,
} from '@/lib/workspace-files/orchestration'
import { withPublicApiRouteHandler } from '@/app/api/public-api-route-handler'
import { resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2Data, v2ErrorForOrchestration, v2WorkspaceAccessError } from '@/app/api/v2/lib/response'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/v2/files/[fileId]/share — Read a file's public share state.
 *
 * `null` means the file has never been shared. `hasPassword` is the only signal
 * carried for a password-gated share; the ciphertext is never exposed.
 */
export const GET = withPublicApiRouteHandler({
  contract: v2GetFileShareContract,
  rateLimitEndpoint: 'file-share',
  handler: async ({ input, auth: { userId, rateLimit } }) => {
    const { fileId } = input.params
    const { workspaceId } = input.query

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
  },
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
export const PUT = withPublicApiRouteHandler({
  contract: v2UpsertFileShareContract,
  rateLimitEndpoint: 'file-share',
  handler: async ({ request, input, auth: { userId, rateLimit } }) => {
    const { fileId } = input.params
    const { workspaceId, isActive, authType, password, allowedEmails } = input.body

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
  },
})
