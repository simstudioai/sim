import { and, eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { refreshOAuthToken } from '@/lib/oauth'
import { db } from '@/db'
import { account } from '@/db/schema'

const logger = createLogger('OAuthUtils')

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

      const { accessToken, expiresIn } = refreshResult

      // Update the token in the database with the actual expiration time from the provider
      await db
        .update(account)
        .set({
          accessToken,
          accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000), // Convert seconds to milliseconds
          updatedAt: new Date(),
        })
        .where(eq(account.id, credential.id))

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
 * @param requestId Optional request ID for log correlation
 * @returns The valid access token or null if refresh fails
 */
export async function refreshAccessTokenIfNeeded(
  credentialId: string,
  userId: string,
  requestId?: string
): Promise<string | null> {
  // Get the credential from the database
  const credentials = await db
    .select()
    .from(account)
    .where(and(eq(account.id, credentialId), eq(account.userId, userId)))
    .limit(1)

  if (!credentials.length) {
    logger.warn(`[${requestId || ''}] Credential not found: ${credentialId}`)
    return null
  }

  const credential = credentials[0]

  // Check if we need to refresh the token
  const expiresAt = credential.accessTokenExpiresAt
  const now = new Date()
  const needsRefresh = !expiresAt || expiresAt <= now

  let accessToken = credential.accessToken

  if (needsRefresh && credential.refreshToken) {
    logger.info(
      `[${requestId || ''}] Token expired, attempting to refresh for credential: ${credentialId}`
    )
    try {
      const refreshedToken = await refreshOAuthToken(credential.providerId, credential.refreshToken)

      if (!refreshedToken) {
        logger.error(
          `[${requestId || ''}] Failed to refresh token for credential: ${credentialId}`,
          {
            credentialId,
            providerId: credential.providerId,
            userId: credential.userId,
            hasRefreshToken: !!credential.refreshToken,
          }
        )
        return null
      }

      // Update the token in the database
      await db
        .update(account)
        .set({
          accessToken: refreshedToken.accessToken,
          accessTokenExpiresAt: new Date(Date.now() + refreshedToken.expiresIn * 1000), // Default 1 hour expiry
          updatedAt: new Date(),
        })
        .where(eq(account.id, credentialId))

      logger.info(
        `[${requestId || ''}] Successfully refreshed access token for credential: ${credentialId}`
      )
      return refreshedToken.accessToken
    } catch (error) {
      logger.error(`[${requestId || ''}] Error refreshing token for credential: ${credentialId}`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        providerId: credential.providerId,
        credentialId,
        userId: credential.userId,
      })
      return null
    }
  } else if (!accessToken) {
    logger.error(`[${requestId || ''}] Missing access token for credential: ${credential.id}`)
    return null
  }

  return accessToken
}
