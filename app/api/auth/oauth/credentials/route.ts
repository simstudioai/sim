import { NextRequest, NextResponse } from 'next/server'
import { and, eq } from 'drizzle-orm'
import { jwtDecode } from 'jwt-decode'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { parseProvider } from '@/lib/oauth'
import { OAuthService } from '@/lib/oauth'
import { db } from '@/db'
import { account } from '@/db/schema'

const logger = createLogger('OAuthCredentialsAPI')

interface GoogleIdToken {
  email?: string
  sub?: string
}

/**
 * Get credentials for a specific provider
 */
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    // Get the session
    const session = await getSession()

    // Check if the user is authenticated
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthenticated credentials request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    // Get the provider from the query params
    const { searchParams } = new URL(request.url)
    const provider = searchParams.get('provider') as OAuthService | null

    if (!provider) {
      logger.warn(`[${requestId}] Missing provider parameter`)
      return NextResponse.json({ error: 'Provider is required' }, { status: 400 })
    }

    // Parse the provider to get base provider and feature type
    const { baseProvider } = parseProvider(provider)

    // Get all accounts for this user and provider
    const accounts = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, session.user.id), eq(account.providerId, provider)))

    // Transform accounts into credentials
    const credentials = await Promise.all(
      accounts.map(async (acc) => {
        // Extract the feature type from providerId (e.g., 'google-default' -> 'default')
        const [_, featureType = 'default'] = acc.providerId.split('-')

        // For Google accounts, try to get the email from the ID token
        let name = acc.accountId
        if (baseProvider === 'google' && acc.idToken) {
          try {
            const decoded = jwtDecode<GoogleIdToken>(acc.idToken)
            if (decoded.email) {
              name = decoded.email
            }
          } catch (error) {
            logger.warn(`[${requestId}] Error decoding Google ID token`, { accountId: acc.id })
          }
        }

        return {
          id: acc.id,
          name,
          provider,
          lastUsed: acc.updatedAt.toISOString(),
          isDefault: featureType === 'default',
        }
      })
    )

    return NextResponse.json({ credentials }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching OAuth credentials`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
