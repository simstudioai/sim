import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import {
  oauthTokenGetContract,
  oauthTokenPostContract,
} from '@/lib/api/contracts/oauth-connections'
import { getValidationErrorMessage, parseRequest } from '@/lib/api/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { AuthType, checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID } from '@/lib/oauth/types'
import {
  getAtlassianServiceAccountSecret,
  getCredential,
  getOAuthToken,
  getServiceAccountToken,
  refreshTokenIfNeeded,
  resolveOAuthAccountId,
} from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthTokenAPI')

const SALESFORCE_INSTANCE_URL_REGEX = /__sf_instance__:([^\s]+)/

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

        return NextResponse.json({ accessToken }, { status: 200 })
      } catch (error) {
        const message = getErrorMessage(error, 'Failed to get OAuth token')
        logger.warn(`[${requestId}] OAuth token error: ${message}`)
        return NextResponse.json({ error: message }, { status: 403 })
      }
    }

    if (!credentialId) {
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    const resolved = await resolveOAuthAccountId(credentialId)
    if (resolved?.credentialType === 'service_account' && resolved.credentialId) {
      const authz = await authorizeCredentialUse(request, {
        credentialId,
        workflowId: workflowId ?? undefined,
        requireWorkflowIdForInternal: false,
        callerUserId,
      })
      if (!authz.ok) {
        return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
      }

      try {
        if (resolved.providerId === ATLASSIAN_SERVICE_ACCOUNT_PROVIDER_ID) {
          const secret = await getAtlassianServiceAccountSecret(resolved.credentialId)
          return NextResponse.json(
            {
              accessToken: secret.apiToken,
              cloudId: secret.cloudId,
              domain: secret.domain,
            },
            { status: 200 }
          )
        }
        const accessToken = await getServiceAccountToken(
          resolved.credentialId,
          scopes ?? [],
          impersonateEmail
        )
        return NextResponse.json({ accessToken }, { status: 200 })
      } catch (error) {
        logger.error(`[${requestId}] Service account token error:`, error)
        return NextResponse.json({ error: 'Failed to get service account token' }, { status: 401 })
      }
    }

    const authz = await authorizeCredentialUse(request, {
      credentialId,
      workflowId: workflowId ?? undefined,
      requireWorkflowIdForInternal: false,
      callerUserId,
    })
    if (!authz.ok || !authz.credentialOwnerUserId) {
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

    try {
      const { accessToken } = await refreshTokenIfNeeded(
        requestId,
        credential,
        resolvedCredentialId
      )

      let instanceUrl: string | undefined
      if (credential.providerId === 'salesforce' && credential.scope) {
        const instanceMatch = credential.scope.match(SALESFORCE_INSTANCE_URL_REGEX)
        if (instanceMatch) {
          instanceUrl = instanceMatch[1]
        }
      }

      return NextResponse.json(
        {
          accessToken,
          idToken: credential.idToken || undefined,
          ...(instanceUrl && { instanceUrl }),
        },
        { status: 200 }
      )
    } catch (error) {
      logger.error(`[${requestId}] Failed to refresh access token:`, error)
      return NextResponse.json({ error: 'Failed to refresh access token' }, { status: 401 })
    }
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

    try {
      const { accessToken } = await refreshTokenIfNeeded(
        requestId,
        credential,
        resolvedCredentialId
      )

      // For Salesforce, extract instanceUrl from the scope field
      let instanceUrl: string | undefined
      if (credential.providerId === 'salesforce' && credential.scope) {
        const instanceMatch = credential.scope.match(SALESFORCE_INSTANCE_URL_REGEX)
        if (instanceMatch) {
          instanceUrl = instanceMatch[1]
        }
      }

      return NextResponse.json(
        {
          accessToken,
          idToken: credential.idToken || undefined,
          ...(instanceUrl && { instanceUrl }),
        },
        { status: 200 }
      )
    } catch (_error) {
      return NextResponse.json({ error: 'Failed to refresh access token' }, { status: 401 })
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching access token`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
