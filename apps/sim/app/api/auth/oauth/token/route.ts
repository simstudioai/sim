import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { generateRequestId } from '@/lib/core/utils/request'
import { getCredential, getOAuthToken, refreshTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthTokenAPI')

const SALESFORCE_INSTANCE_URL_REGEX = /__sf_instance__:([^\s]+)/

const tokenRequestSchema = z
  .object({
    credentialId: z.string().min(1).optional(),
    credentialAccountUserId: z.string().min(1).optional(),
    providerId: z.string().min(1).optional(),
    workflowId: z.string().min(1).nullish(),
  })
  .refine(
    (data) => data.credentialId || (data.credentialAccountUserId && data.providerId),
    'Either credentialId or (credentialAccountUserId + providerId) is required'
  )

const tokenQuerySchema = z.object({
  credentialId: z
    .string({
      required_error: 'Credential ID is required',
      invalid_type_error: 'Credential ID is required',
    })
    .min(1, 'Credential ID is required'),
})

/**
 * Get an access token for a specific credential
 * Supports both session-based authentication (for client-side requests)
 * and workflow-based authentication (for server-side requests)
 */
export async function POST(request: NextRequest) {
  const requestId = generateRequestId()

  logger.info(`[${requestId}] OAuth token API POST request received`)

  try {
    const rawBody = await request.json()
    const parseResult = tokenRequestSchema.safeParse(rawBody)

    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]
      const errorMessage = firstError?.message || 'Validation failed'

      logger.warn(`[${requestId}] Invalid token request`, {
        errors: parseResult.error.errors,
      })

      return NextResponse.json(
        {
          error: errorMessage,
        },
        { status: 400 }
      )
    }

    const { credentialId, credentialAccountUserId, providerId, workflowId } = parseResult.data

    if (credentialAccountUserId && providerId) {
      logger.info(`[${requestId}] Fetching token by credentialAccountUserId + providerId`, {
        credentialAccountUserId,
        providerId,
      })

      const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
      if (!auth.success || auth.authType !== 'session' || !auth.userId) {
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
        const message = error instanceof Error ? error.message : 'Failed to get OAuth token'
        logger.warn(`[${requestId}] OAuth token error: ${message}`)
        return NextResponse.json({ error: message }, { status: 403 })
      }
    }

    if (!credentialId) {
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    const authz = await authorizeCredentialUse(request, {
      credentialId,
      workflowId: workflowId ?? undefined,
      requireWorkflowIdForInternal: false,
    })
    if (!authz.ok || !authz.credentialOwnerUserId) {
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }

    const credential = await getCredential(requestId, credentialId, authz.credentialOwnerUserId)

    if (!credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    try {
      const { accessToken } = await refreshTokenIfNeeded(requestId, credential, credentialId)

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
}

/**
 * Get the access token for a specific credential
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const { searchParams } = new URL(request.url)
    const rawQuery = {
      credentialId: searchParams.get('credentialId'),
    }

    const parseResult = tokenQuerySchema.safeParse(rawQuery)

    if (!parseResult.success) {
      const firstError = parseResult.error.errors[0]
      const errorMessage = firstError?.message || 'Validation failed'

      logger.warn(`[${requestId}] Invalid query parameters`, {
        errors: parseResult.error.errors,
      })

      return NextResponse.json(
        {
          error: errorMessage,
        },
        { status: 400 }
      )
    }

    const { credentialId } = parseResult.data

    // For GET requests, we only support session-based authentication
    const auth = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
    if (!auth.success || auth.authType !== 'session' || !auth.userId) {
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    const credential = await getCredential(requestId, credentialId, auth.userId)

    if (!credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    if (!credential.accessToken) {
      logger.warn(`[${requestId}] No access token available for credential`)
      return NextResponse.json({ error: 'No access token available' }, { status: 400 })
    }

    try {
      const { accessToken } = await refreshTokenIfNeeded(requestId, credential, credentialId)

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
}
