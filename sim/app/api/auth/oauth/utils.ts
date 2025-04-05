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
      const refreshedToken = await refreshOAuthToken(providerId, credential.refreshToken!)

      if (!refreshedToken) {
        logger.error(`Failed to refresh token for user ${userId}, provider ${providerId}`)
        return null
      }

      // Update the token in the database
      await db
        .update(account)
        .set({
          accessToken: refreshedToken,
          accessTokenExpiresAt: new Date(Date.now() + 3600 * 1000), // Default 1 hour expiry
          updatedAt: new Date(),
        })
        .where(eq(account.id, credential.id))

      logger.info(`Successfully refreshed token for user ${userId}, provider ${providerId}`)
      return refreshedToken
    } catch (error) {
      logger.error(`Error refreshing token for user ${userId}, provider ${providerId}`, error)
      return null
    }
  }

  logger.info(`Found valid OAuth token for user ${userId}, provider ${providerId}`)
  return credential.accessToken
}
