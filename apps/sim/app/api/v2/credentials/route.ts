import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import {
  v2CreateCredentialContract,
  v2ListCredentialsContract,
} from '@/lib/api/contracts/v2/credentials'
import { parseRequest } from '@/lib/api/server'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { getCredentialActorContext } from '@/lib/credentials/access'
import { performCreateCredential } from '@/lib/credentials/orchestration'
import { listVisibleWorkspaceCredentials } from '@/lib/credentials/queries'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import {
  toV2Credential,
  toV2CredentialRow,
  v2CredentialOrchestrationError,
} from '@/app/api/v2/credentials/utils'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CursorList,
  v2Data,
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
  const requestId = generateRequestId()

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

    const { workspaceId, type, providerId } = parsed.data.query

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
      type,
      providerId,
    })

    // The per-workspace credential set is small and bounded → a single full page.
    return v2CursorList(credentials.map(toV2Credential), null, { rateLimit })
  } catch (error) {
    logger.error(`[${requestId}] Error listing credentials`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})

/** POST /api/v2/credentials — Create a workspace credential. */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const rateLimit = await checkRateLimit(request, 'credentials')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!

    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2CreateCredentialContract,
      request,
      {},
      { validationErrorResponse: v2ValidationError }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId } = parsed.data.body

    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'write')
    if (access) return v2WorkspaceAccessError(access)

    const result = await performCreateCredential({ ...parsed.data.body, userId, request })

    if (!result.success || !result.credential) {
      return v2CredentialOrchestrationError(
        result.errorCode,
        result.error ?? 'Failed to create credential',
        { providerUnavailable: result.providerUnavailable }
      )
    }

    /**
     * A fresh insert makes the creator an admin, but an idempotent match against
     * an existing source does not — the orchestration admits a caller who is
     * only a *member* of that credential. Resolve the real role rather than
     * assuming the create case, or the response would advertise administrative
     * actions the caller cannot perform.
     */
    const actor = result.created
      ? { isAdmin: true }
      : await getCredentialActorContext(result.credential.id, userId)
    const credential = toV2CredentialRow(result.credential, actor.isAdmin ? 'admin' : 'member')

    /**
     * Always 201, including when an existing credential already occupied this
     * source. Create is idempotent on the source tuple, and the caller's
     * post-condition — "a credential with this source exists, here it is" — is
     * the same either way.
     */
    return v2Data({ credential }, { rateLimit, status: 201 })
  } catch (error) {
    logger.error(`[${requestId}] Error creating credential`, {
      error: getErrorMessage(error, 'Unknown error'),
    })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
