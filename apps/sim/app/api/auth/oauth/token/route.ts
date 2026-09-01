import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  MANAGED_OAUTH_DELEGATION_HEADER,
  oauthTokenGetContract,
  oauthTokenPostContract,
} from '@/lib/api/contracts/oauth-connections'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { AuthType, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { authenticateManagedOAuthDelegation } from '@/lib/credentials/application/managed-oauth-delegation'
import { getCredential, getOAuthToken } from '@/lib/oauth/credential-service'
import {
  completeOAuthCredentialToken,
  resolveCredentialAccessToken,
} from '@/lib/oauth/token-resolution'
import { captureServerEvent } from '@/lib/posthog/server'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthTokenAPI')

/**
 * Get an access token for a specific credential
 * Supports both session-based authentication (for client-side requests)
 * and workflow-based authentication (for server-side requests)
 */
export const POST = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  logger.info(`[${requestId}] OAuth token API POST request received`)

  try {
    const parsed = await parseRequest(
      oauthTokenPostContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid token request`, { errors: error.issues })
          return NextResponse.json(
            { error: getValidationErrorMessage(error, 'Validation failed') },
            { status: 400 }
          )
        },
      }
    )
    if (!parsed.success) return parsed.response

    const {
      credentialId,
      credentialAccountUserId,
      providerId,
      toolId,
      workflowId,
      scopes,
      impersonateEmail,
    } = parsed.data.body
    const callerUserId = parsed.data.query.userId

    if (credentialAccountUserId && providerId) {
      logger.info(`[${requestId}] Fetching token by credentialAccountUserId + providerId`, {
        credentialAccountUserId,
        providerId,
      })

      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || auth.authType !== AuthType.SESSION || !auth.userId) {
        logger.warn(`[${requestId}] Unauthorized request for credentialAccountUserId path`, {
          success: auth.success,
          authType: auth.authType,
        })
        return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
      }

      if (auth.userId !== credentialAccountUserId) {
        logger.warn(
          `[${requestId}] User ${auth.userId} attempted to access credentials for ${credentialAccountUserId}`
        )
        return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
      }

      try {
        const accessToken = await getOAuthToken(credentialAccountUserId, providerId)
        if (!accessToken) {
          return NextResponse.json(
            {
              error: `No credential found for user ${credentialAccountUserId} and provider ${providerId}`,
            },
            { status: 404 }
          )
        }

        recordAudit({
          actorId: auth.userId,
          action: AuditAction.CREDENTIAL_ACCESSED,
          resourceType: AuditResourceType.CREDENTIAL,
          resourceId: providerId,
          description: `Accessed OAuth credential for provider ${providerId}`,
          metadata: {
            provider: providerId,
            credentialType: 'oauth',
            credentialAccountUserId,
          },
          request,
        })
        captureServerEvent(auth.userId, 'credential_used', {
          credential_type: 'oauth',
          provider_id: providerId,
        })

        return NextResponse.json({ accessToken }, { status: 200 })
      } catch (error) {
        const message = getErrorMessage(error, 'Failed to get OAuth token')
        logger.warn(`[${requestId}] OAuth token error: ${message}`)
        return NextResponse.json({ error: message }, { status: 403 })
      }
    }

    const managedOAuthDelegation = parsed.data.headers?.[MANAGED_OAUTH_DELEGATION_HEADER]
    const result = await resolveCredentialAccessToken({
      requestId,
      credentialId,
      workflowId: workflowId ?? undefined,
      toolId,
      scopes,
      impersonateEmail,
      callerUserId,
      auditRequest: request,
      authenticate: () => checkSessionOrInternalAuth(request, { requireWorkflowId: false }),
      ...(managedOAuthDelegation
        ? {
            resolveManagedPrincipal: (managedCredentialId: string) =>
              authenticateManagedOAuthDelegation(managedOAuthDelegation, managedCredentialId),
          }
        : {}),
    })

    if (!result.ok) {
      return NextResponse.json(
        { ...(result.code ? { code: result.code } : {}), error: result.error },
        { status: result.status }
      )
    }

    return NextResponse.json(result.token, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error getting access token`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})

/**
 * Get the access token for a specific credential
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    const parsed = await parseRequest(
      oauthTokenGetContract,
      request,
      {},
      {
        validationErrorResponse: (error) => {
          logger.warn(`[${requestId}] Invalid query parameters`, { errors: error.issues })
          return NextResponse.json(
            { error: getValidationErrorMessage(error, 'Validation failed') },
            { status: 400 }
          )
        },
      }
    )
    if (!parsed.success) return parsed.response

    const { credentialId } = parsed.data.query

    const authz = await authorizeCredentialUse(request, {
      credentialId,
      requireWorkflowIdForInternal: false,
    })
    if (!authz.ok || authz.authType !== AuthType.SESSION || !authz.credentialOwnerUserId) {
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }

    const resolvedCredentialId = authz.resolvedCredentialId || credentialId
    const credential = await getCredential(
      requestId,
      resolvedCredentialId,
      authz.credentialOwnerUserId
    )

    if (!credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    if (!credential.accessToken) {
      logger.warn(`[${requestId}] No access token available for credential`)
      return NextResponse.json({ error: 'No access token available' }, { status: 400 })
    }

    const result = await completeOAuthCredentialToken({
      requestId,
      credential,
      resolvedCredentialId,
      actorId: authz.requesterUserId,
      workspaceId: authz.workspaceId ?? null,
      auditRequest: request,
    })

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result.token, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching access token`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
