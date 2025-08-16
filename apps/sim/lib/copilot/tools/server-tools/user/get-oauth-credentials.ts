import { eq } from 'drizzle-orm'
import { jwtDecode } from 'jwt-decode'
import { createLogger } from '@/lib/logs/console/logger'
import { refreshTokenIfNeeded } from '@/app/api/auth/oauth/utils'
import { db } from '@/db'
import { account, user } from '@/db/schema'
import { BaseCopilotTool } from '../base'

interface GetOAuthCredentialsParams {
  userId: string
}

interface OAuthCredentialItem {
  id: string
  name: string
  provider: string
  lastUsed: string
  isDefault: boolean
  accessToken: string | null
}

interface GetOAuthCredentialsResult {
  credentials: OAuthCredentialItem[]
  total: number
}

class GetOAuthCredentialsTool extends BaseCopilotTool<
  GetOAuthCredentialsParams,
  GetOAuthCredentialsResult
> {
  readonly id = 'get_oauth_credentials'
  readonly displayName = 'Getting OAuth credentials'

  protected async executeImpl(
    params: GetOAuthCredentialsParams
  ): Promise<GetOAuthCredentialsResult> {
    const logger = createLogger('GetOAuthCredentials')

    const { userId } = params
    if (!userId || typeof userId !== 'string' || userId.trim().length === 0) {
      throw new Error('userId is required')
    }

    logger.info('Fetching OAuth credentials for user', { userId })

    // Fetch all accounts for this user
    const accounts = await db.select().from(account).where(eq(account.userId, userId))

    // Fetch user email for fallback display purposes
    const userRecord = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)

    const userEmail = userRecord.length > 0 ? userRecord[0]?.email : null

    const credentials: OAuthCredentialItem[] = []

    // Short request id for log correlation
    const requestId = crypto.randomUUID().slice(0, 8)

    for (const acc of accounts) {
      const providerId = acc.providerId
      const [baseProvider, featureType = 'default'] = providerId.split('-')

      let displayName = ''

      // Try to extract an email/name from idToken if present
      if (acc.idToken) {
        try {
          const decoded = jwtDecode<{ email?: string; name?: string }>(acc.idToken)
          if (decoded.email) {
            displayName = decoded.email
          } else if (decoded.name) {
            displayName = decoded.name
          }
        } catch (_err) {
          logger.warn('Failed to decode idToken for credential', { accountId: acc.id })
        }
      }

      // Provider-specific fallback (e.g., GitHub username)
      if (!displayName && baseProvider === 'github') {
        displayName = `${acc.accountId} (GitHub)`
      }

      // Fallback to user's email if available
      if (!displayName && userEmail) {
        displayName = userEmail
      }

      // Final fallback to accountId with provider name
      if (!displayName) {
        displayName = `${acc.accountId} (${baseProvider})`
      }

      // Ensure we return a valid access token, refreshing if needed
      let accessToken: string | null = acc.accessToken ?? null
      try {
        const { accessToken: refreshedToken } = await refreshTokenIfNeeded(
          requestId,
          acc as any,
          acc.id
        )
        accessToken = refreshedToken || accessToken
      } catch (_error) {
        // If refresh fails, we still return whatever we had (may be null)
      }

      credentials.push({
        id: acc.id,
        name: displayName,
        provider: providerId,
        lastUsed: acc.updatedAt.toISOString(),
        isDefault: featureType === 'default',
        accessToken,
      })
    }

    logger.info('Fetched OAuth credentials', { userId, count: credentials.length })

    return { credentials, total: credentials.length }
  }
}

export const getOAuthCredentialsTool = new GetOAuthCredentialsTool()
