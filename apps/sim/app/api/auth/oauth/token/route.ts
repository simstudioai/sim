import { type NextRequest, NextResponse } from 'next/server'
import { authorizeCredentialUse } from '@/lib/auth/credential-access'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { getCredential, refreshTokenIfNeeded } from '@/app/api/auth/oauth/utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthTokenAPI')

/**
 * Get an access token for a specific credential
 * Supports both session-based authentication (for client-side requests)
 * and workflow-based authentication (for server-side requests)
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  logger.info(`[${requestId}] OAuth token API POST request received`)

  try {
    // Parse request body
    const body = await request.json()
    const { credentialId, workflowId } = body

    if (!credentialId) {
      logger.warn(`[${requestId}] Credential ID is required`)
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    // We already have workflowId from the parsed body; avoid forcing hybrid auth to re-read it
    const authz = await authorizeCredentialUse(request, {
      credentialId,
      workflowId,
      requireWorkflowIdForInternal: false,
    })
    if (!authz.ok || !authz.credentialOwnerUserId) {
      return NextResponse.json({ error: authz.error || 'Unauthorized' }, { status: 403 })
    }

    // Fetch the credential as the owner to enforce ownership scoping
    const credential = await getCredential(requestId, credentialId, authz.credentialOwnerUserId)

    try {
      // Refresh the token if needed
      const { accessToken } = await refreshTokenIfNeeded(requestId, credential, credentialId)
      return NextResponse.json({ accessToken }, { status: 200 })
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
  const requestId = crypto.randomUUID().slice(0, 8) // Short request ID for correlation

  try {
    // Get the credential ID from the query params
    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')

    if (!credentialId) {
      logger.warn(`[${requestId}] Missing credential ID`)
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

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

    try {
      const { accessToken } = await refreshTokenIfNeeded(requestId, credential, credentialId)
      if (!accessToken) {
        logger.warn(`[${requestId}] No access token could be obtained for credential`)
        return NextResponse.json({ error: 'No access token available' }, { status: 400 })
      }
      return NextResponse.json({ accessToken }, { status: 200 })
    } catch (_error) {
      return NextResponse.json({ error: 'Failed to refresh access token' }, { status: 401 })
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching access token`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
