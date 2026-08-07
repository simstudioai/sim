import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { NextRequest } from 'next/server'
import { v2ListSecretsContract } from '@/lib/api/contracts/v2/secrets'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { listVisibleWorkspaceCredentials } from '@/lib/credentials/queries'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import { checkRateLimit, resolveWorkspaceAccess } from '@/app/api/v1/middleware'
import { v2ApiGateError } from '@/app/api/v2/lib/gate'
import {
  v2CursorList,
  v2Error,
  v2RateLimitError,
  v2ValidationError,
  v2WorkspaceAccessError,
} from '@/app/api/v2/lib/response'
import { secretCredentialTypes, toV2Secret } from '@/app/api/v2/secrets/utils'

const logger = createLogger('V2SecretsAPI')

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** GET /api/v2/secrets — List secret names and metadata without reading their values. */
export const GET = withRouteHandler(async (request: NextRequest) => {
  try {
    const rateLimit = await checkRateLimit(request, 'secrets')
    if (!rateLimit.allowed) return v2RateLimitError(rateLimit)

    const userId = rateLimit.userId!
    const gate = await v2ApiGateError(userId)
    if (gate) return gate

    const parsed = await parseRequest(
      v2ListSecretsContract,
      request,
      {},
      {
        validationErrorResponse: v2ValidationError,
      }
    )
    if (!parsed.success) return parsed.response

    const { workspaceId, scope, search, sortBy, sortOrder } = parsed.data.query
    const access = await resolveWorkspaceAccess(rateLimit, userId, workspaceId, 'read')
    if (access) return v2WorkspaceAccessError(access)

    const workspaceAccess = await checkWorkspaceAccess(workspaceId, userId)
    const credentials = await listVisibleWorkspaceCredentials({
      workspaceId,
      userId,
      workspaceAccess,
      types: [...secretCredentialTypes(scope)],
      search,
      sortBy: sortBy === 'name' ? 'displayName' : sortBy,
      sortOrder,
    })
    const secrets = credentials
      .filter((row) => row.type === 'env_workspace' || row.envOwnerUserId === userId)
      .map((row) => toV2Secret(row, userId))

    return v2CursorList(secrets, null, { rateLimit })
  } catch (error) {
    logger.error('Error listing secrets', { error: getErrorMessage(error, 'Unknown error') })
    return v2Error('INTERNAL_ERROR', 'Internal server error')
  }
})
