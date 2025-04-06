import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { refreshOAuthToken } from '@/lib/oauth'
import { db } from '@/db'
import { account, workflow } from '@/db/schema'

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
    let userId: string | undefined

    // If workflowId is provided, this is a server-side request
    if (workflowId) {
      // Get the workflow to verify the user ID
      const workflows = await db
        .select({ userId: workflow.userId })
        .from(workflow)
        .where(eq(workflow.id, workflowId))
        .limit(1)

      if (!workflows.length) {
        logger.warn(`[${requestId}] Workflow not found`)
        return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
      }

      userId = workflows[0].userId
    } else {
      // This is a client-side request, use the session
      const session = await getSession()

      // Check if the user is authenticated
      if (!session?.user?.id) {
        logger.warn(`[${requestId}] Unauthenticated token request rejected`)
        return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
      }

      userId = session.user.id
    }

    // Get the credential from the database
    const credentials = await db
      .select()
      .from(account)
      .where(and(eq(account.id, credentialId), eq(account.userId, userId)))
      .limit(1)

    if (!credentials.length) {
      logger.warn(`[${requestId}] Credential not found`)
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    const credential = credentials[0]

    // Check if we need to refresh the token
    const expiresAt = credential.accessTokenExpiresAt
    const now = new Date()
    const needsRefresh = !expiresAt || expiresAt <= now

    if (needsRefresh && credential.refreshToken) {
      try {
        const refreshResult = await refreshOAuthToken(
          credential.providerId,
          credential.refreshToken
        )

        if (!refreshResult) {
          throw new Error('Failed to refresh token')
        }

        const { accessToken: refreshedToken, expiresIn } = refreshResult

        await db
          .update(account)
          .set({
            accessToken: refreshedToken,
            accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000), // Use provider's expiry
            updatedAt: new Date(),
          })
          .where(eq(account.id, credentialId))

        logger.info(`[${requestId}] Successfully refreshed access token`)
        return NextResponse.json({ accessToken: refreshedToken }, { status: 200 })
      } catch (error) {
        logger.error(`[${requestId}] Error refreshing token`, error)
        return NextResponse.json({ error: 'Failed to refresh access token' }, { status: 500 })
      }
    }

    logger.info(`[${requestId}] Access token is valid`)
    return NextResponse.json({ accessToken: credential.accessToken }, { status: 200 })
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
    // Get the session
    const session = await getSession()

    // Check if the user is authenticated
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthenticated request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    // Get the credential ID from the query params
    const { searchParams } = new URL(request.url)
    const credentialId = searchParams.get('credentialId')

    if (!credentialId) {
      logger.warn(`[${requestId}] Missing credential ID`)
      return NextResponse.json({ error: 'Credential ID is required' }, { status: 400 })
    }

    // Get the credential from the database
    const credentials = await db.select().from(account).where(eq(account.id, credentialId)).limit(1)

    if (!credentials.length) {
      logger.warn(`[${requestId}] Credential not found`, { credentialId })
      return NextResponse.json({ error: 'Credential not found' }, { status: 404 })
    }

    const credential = credentials[0]

    // Check if the credential belongs to the user
    if (credential.userId !== session.user.id) {
      logger.warn(`[${requestId}] Unauthorized credential access attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Check if the access token is valid
    if (!credential.accessToken) {
      logger.warn(`[${requestId}] No access token available for credential`)
      return NextResponse.json({ error: 'No access token available' }, { status: 400 })
    }

    // Check if the token is expired and refresh if needed
    const now = new Date()
    const tokenExpiry = credential.accessTokenExpiresAt
    let accessToken = credential.accessToken

    if (tokenExpiry && tokenExpiry < now && credential.refreshToken) {
      logger.info(`[${requestId}] Access token expired, attempting to refresh`)

      try {
        // Refresh the token using the centralized utility
        const refreshResult = await refreshOAuthToken(
          credential.providerId,
          credential.refreshToken
        )

        if (!refreshResult) {
          throw new Error('Failed to refresh token')
        }

        const { accessToken: refreshedToken, expiresIn } = refreshResult
        logger.info(`[${requestId}] Token refreshed successfully`)

        // Update the token in the database with the correct expiration time
        await db
          .update(account)
          .set({
            accessToken: refreshedToken,
            accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000), // Use provider's expiry
            updatedAt: new Date(),
          })
          .where(eq(account.id, credentialId))

        accessToken = refreshedToken
      } catch (refreshError) {
        logger.error(`[${requestId}] Error refreshing token`, refreshError)
        return NextResponse.json({ error: 'Failed to refresh access token' }, { status: 401 })
      }
    }

    // Return the access token
    return NextResponse.json({ accessToken }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching access token`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
