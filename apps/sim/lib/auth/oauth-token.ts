import { db } from '@sim/db'
import { oauthAccessToken } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, gt } from 'drizzle-orm'

const logger = createLogger('OAuthToken')

interface OAuthTokenValidationResult {
  success: boolean
  userId?: string
  scopes?: string[]
  error?: string
}

/**
 * Validates an OAuth 2.1 access token by looking it up in the oauthAccessToken table.
 * Returns the associated userId and scopes if the token is valid and not expired.
 */
export async function validateOAuthAccessToken(token: string): Promise<OAuthTokenValidationResult> {
  try {
    const [record] = await db
      .select({
        userId: oauthAccessToken.userId,
        scopes: oauthAccessToken.scopes,
        accessTokenExpiresAt: oauthAccessToken.accessTokenExpiresAt,
      })
      .from(oauthAccessToken)
      .where(
        and(
          eq(oauthAccessToken.accessToken, token),
          gt(oauthAccessToken.accessTokenExpiresAt, new Date())
        )
      )
      .limit(1)

    if (!record) {
      return { success: false, error: 'Invalid or expired OAuth access token' }
    }

    if (!record.userId) {
      return { success: false, error: 'OAuth token has no associated user' }
    }

    const scopes = record.scopes.split(' ').filter(Boolean)

    return { success: true, userId: record.userId, scopes }
  } catch (error) {
    logger.error('OAuth access token validation failed', { error })
    return { success: false, error: 'Token validation error' }
  }
}
