import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2ListCredentialsContract } from '@/lib/api/contracts/v2/credentials'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listVisibleWorkspaceCredentials } from '@/lib/credentials/queries'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { toV2Credential } from '@/app/api/v2/credentials/utils'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CursorList,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'

const logger = createLogger('V2CredentialsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/credentials — List the credentials the caller can see in a workspace. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const rateLimit = await checkRateLimit(request, 'credentials')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2ListCredentialsContract,
      request,
      {},
      { validationErrorResponse: v2ValidationError }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, type, providerId, search, sortBy, sortOrder } = parsed.data.query

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    /**
     * Credential visibility is per credential, not per workspace: membership
     * rows and shared-type admin access decide what this caller sees, so the
     * workspace permission is re-read here for the `canAdmin` bit.
     */
    const workspaceAccess = await checkWorkspaceAccess(workspaceId, userId)
    const credentials = await listVisibleWorkspaceCredentials({
      workspaceId,
      userId,
      workspaceAccess,
      types: type ? [type] : ['oauth', 'service_account'],
      providerId,
      search,
      sortBy,
      sortOrder,
    })

    // The per-workspace credential set is small and bounded → a single full page.
    return v2CursorList(credentials.map(toV2Credential), null, { rateLimit })
  } catch (error) {
    logger.error('Error listing credentials', {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
