import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'
import { getCredential, refreshTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthTokenAPI')

const tokenRequestSchema = z.object({
  credentialId: z
    .string({ required_error: 'Credential ID is required' })
    .min(1, 'Credential ID is required'),
  workflowId: z.string().min(1, 'Workflow ID is required').nullish(),
})

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

    const { credentialId, workflowId } = parseResult.data

    // We already have workflowId from the parsed body; avoid forcing hybrid auth to re-read it
    const authz = await authorizeCredentialUse(request, {
      credentialId,
      workflowId: workflowId ?? undefined,
      requireWorkflowIdForInternal: false,
    })
    if (!authz.ok || !authz.credentialOwnerUserId) {
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }

    // Fetch the credential as the owner to enforce ownership scoping
    const credential = await getCredential(requestId, credentialId, authz.credentialOwnerUserId)

    if (!credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    try {
      // Refresh the token if needed
      const { accessToken } = await refreshTokenIfNeeded(requestId, credential, credentialId)
      return NextResponse.json(
        {
          accessToken,
          idToken: credential.idToken || undefined,
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
    const auth = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!auth.success || auth.authType !== 'session' || !auth.userId) {
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    // Get the credential from the database
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
      return NextResponse.json(
        {
          accessToken,
          idToken: credential.idToken || undefined,
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
