import { NextRequest, NextResponse } from 'next/server'
import { createLogger } from '@/lib/logs/console-logger'
import { getCredential, getUserId, refreshTokenIfNeeded } from '../utils'

export const dynamic = 'force-dynamic'

const logger = createLogger('OAuthTokenAPI')

/**
 * Get an access token for a specific credential
 * Supports both session-based authentication (for client-side requests)
 * and workflow-based authentication (for server-side requests)
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    // Parse request body
    const body = await request.json()
    const { credentialId, workflowId } = body

    if (!credentialId) {
      logger.warn(`[${requestId}] Credential ID is required`)
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    // Determine the user ID based on the context
    const userId = await getUserId(requestId, workflowId)

    if (!userId) {
      return NextResponse.json(
        { error: workflowId ? 'Workflow not found' : 'User not authenticated' },
        { status: workflowId ? 404 : 401 }
      )
    }

    // Get the credential from the database
    const credential = await getCredential(requestId, credentialId, userId)

    if (!credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    try {
      // Refresh the token if needed
      const { accessToken } = await refreshTokenIfNeeded(requestId, credential, credentialId)
      return NextResponse.json({ accessToken }, { status: 200 })
    } catch (error) {
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
    const userId = await getUserId(requestId)

    if (!userId) {
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    // Get the credential from the database
    const credential = await getCredential(requestId, credentialId, userId)

    if (!credential) {
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    // Check if the access token is valid
    if (!credential.accessToken) {
      logger.warn(`[${requestId}] No access token available for credential`)
      return NextResponse.json({ error: 'No access token available' }, { status: 400 })
    }

    try {
      // Refresh the token if needed
      const { accessToken } = await refreshTokenIfNeeded(requestId, credential, credentialId)
      return NextResponse.json({ accessToken }, { status: 200 })
    } catch (error) {
      return NextResponse.json({ error: 'Failed to refresh access token' }, { status: 401 })
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching access token`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
