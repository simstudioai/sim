import { and, eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { refreshOAuthToken } from '@/lib/oauth'
import { db } from '@/db'
import { account, workflow } from '@/db/schema'

const logger = createLogger('OAuthUtilsAPI')

/**
 * Get the user ID based on either a session or a workflow ID
 */
export async function getUserId(
  requestId: string,
  workflowId?: string
): Promise<string | undefined> {
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
      return undefined
    }

    return workflows[0].userId
  }
  // This is a client-side request, use the session
  const session = await getSession()

  // Check if the user is authenticated
  if (!session?.user?.id) {
    logger.warn(`[${requestId}] Unauthenticated request rejected`)
    return undefined
  }

  return session.user.id
}

/**
 * Get a credential by ID and verify it belongs to the user
 */
export async function getCredential(requestId: string, credentialId: string, userId: string) {
  const credentials = await db
    .select()
    .from(account)
    .where(and(eq(account.id, credentialId), eq(account.userId, userId)))
    .limit(1)

  if (!credentials.length) {
    logger.warn(`[${requestId}] Credential not found`)
    return undefined
  }

  return credentials[0]
}

export async function getOAuthToken(userId: string, providerId: string): Promise<string | null> {
  const connections = await db
    .select({
      id: account.id,
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      accessTokenExpiresAt: account.accessTokenExpiresAt,
    })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, providerId)))
    .orderBy(account.createdAt)
    .limit(1)

  if (connections.length === 0) {
    logger.warn(`No OAuth token found for user ${userId}, provider ${providerId}`)
    return null
  }

  const credential = connections[0]

  // Check if we have a valid access token
  if (!credential.accessToken) {
    logger.warn(`Access token is null for user ${userId}, provider ${providerId}`)
    return null
  }

  // Check if the token is expired and needs refreshing
  const now = new Date()
  const tokenExpiry = credential.accessTokenExpiresAt
  const needsRefresh = tokenExpiry && tokenExpiry < now && !!credential.refreshToken

  if (needsRefresh) {
    logger.info(
      `Access token expired for user ${userId}, provider ${providerId}. Attempting to refresh.`
    )

    try {
      // Use the existing refreshOAuthToken function
      const refreshResult = await refreshOAuthToken(providerId, credential.refreshToken!)

      if (!refreshResult) {
        logger.error(`Failed to refresh token for user ${userId}, provider ${providerId}`, {
          providerId,
          userId,
          hasRefreshToken: !!credential.refreshToken,
        })
        return null
      }

      const { accessToken, expiresIn, refreshToken: newRefreshToken } = refreshResult

      // Update the database with new tokens
      const updateData: any = {
        accessToken,
        accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000), // Convert seconds to milliseconds
        updatedAt: new Date(),
      }

      // If we received a new refresh token (some providers like Airtable rotate them), save it
      if (newRefreshToken && newRefreshToken !== credential.refreshToken) {
        logger.info(`Updating refresh token for user ${userId}, provider ${providerId}`)
        updateData.refreshToken = newRefreshToken
      }

      // Update the token in the database with the actual expiration time from the provider
      await db.update(account).set(updateData).where(eq(account.id, credential.id))

      logger.info(`Successfully refreshed token for user ${userId}, provider ${providerId}`)
      return accessToken
    } catch (error) {
      logger.error(`Error refreshing token for user ${userId}, provider ${providerId}`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        providerId,
        userId,
      })
      return null
    }
  }

  logger.info(`Found valid OAuth token for user ${userId}, provider ${providerId}`)
  return credential.accessToken
}

/**
 * Refreshes an OAuth token if needed based on credential information
 * @param credentialId The ID of the credential to check and potentially refresh
 * @param userId The user ID who owns the credential (for security verification)
 * @param requestId Request ID for log correlation
 * @returns The valid access token or null if refresh fails
 */
export async function refreshAccessTokenIfNeeded(
  credentialId: string,
  userId: string,
  requestId: string
): Promise<string | null> {
  // Get the credential directly using the getCredential helper
  const credential = await getCredential(requestId, credentialId, userId)

  if (!credential) {
    return null
  }

  // Check if we need to refresh the token
  const expiresAt = credential.accessTokenExpiresAt
  const now = new Date()
  const needsRefresh = !expiresAt || expiresAt <= now

  const accessToken = credential.accessToken

  if (needsRefresh && credential.refreshToken) {
    logger.info(`[${requestId}] Token expired, attempting to refresh for credential`)
    try {
      const refreshedToken = await refreshOAuthToken(credential.providerId, credential.refreshToken)

      if (!refreshedToken) {
        logger.error(`[${requestId}] Failed to refresh token for credential: ${credentialId}`, {
          credentialId,
          providerId: credential.providerId,
          userId: credential.userId,
          hasRefreshToken: !!credential.refreshToken,
        })
        return null
      }

      // Prepare update data
      const updateData: any = {
        accessToken: refreshedToken.accessToken,
        accessTokenExpiresAt: new Date(Date.now() + refreshedToken.expiresIn * 1000),
        updatedAt: new Date(),
      }

      // If we received a new refresh token, update it
      if (refreshedToken.refreshToken && refreshedToken.refreshToken !== credential.refreshToken) {
        logger.info(`[${requestId}] Updating refresh token for credential`)
        updateData.refreshToken = refreshedToken.refreshToken
      }

      // Update the token in the database
      await db.update(account).set(updateData).where(eq(account.id, credentialId))

      logger.info(`[${requestId}] Successfully refreshed access token for credential`)
      return refreshedToken.accessToken
    } catch (error) {
      logger.error(`[${requestId}] Error refreshing token for credential`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        providerId: credential.providerId,
        credentialId,
        userId: credential.userId,
      })
      return null
    }
  } else if (!accessToken) {
    logger.error(`[${requestId}] Missing access token for credential`)
    return null
  }

  logger.info(`[${requestId}] Access token is valid for credential`)
  return accessToken
}

/**
 * Enhanced version that returns additional information about the refresh operation
 */
export async function refreshTokenIfNeeded(
  requestId: string,
  credential: any,
  credentialId: string
): Promise<{ accessToken: string; refreshed: boolean }> {
  // Check if we need to refresh the token
  const expiresAt = credential.accessTokenExpiresAt
  const now = new Date()
  const needsRefresh = !expiresAt || expiresAt <= now

  // If token is still valid, return it directly
  if (!needsRefresh || !credential.refreshToken) {
    logger.info(`[${requestId}] Access token is valid`)
    return { accessToken: credential.accessToken, refreshed: false }
  }

  try {
    const refreshResult = await refreshOAuthToken(credential.providerId, credential.refreshToken)

    if (!refreshResult) {
      logger.error(`[${requestId}] Failed to refresh token for credential`)
      throw new Error('Failed to refresh token')
    }

    const { accessToken: refreshedToken, expiresIn, refreshToken: newRefreshToken } = refreshResult

    // Prepare update data
    const updateData: any = {
      accessToken: refreshedToken,
      accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000), // Use provider's expiry
      updatedAt: new Date(),
    }

    // If we received a new refresh token, update it
    if (newRefreshToken && newRefreshToken !== credential.refreshToken) {
      logger.info(`[${requestId}] Updating refresh token`)
      updateData.refreshToken = newRefreshToken
    }

    await db.update(account).set(updateData).where(eq(account.id, credentialId))

    logger.info(`[${requestId}] Successfully refreshed access token`)
    return { accessToken: refreshedToken, refreshed: true }
  } catch (error) {
    logger.error(`[${requestId}] Error refreshing token`, error)
    throw error
  }
}
