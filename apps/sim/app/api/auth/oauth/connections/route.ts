import { account, db, user } from '@sim/db'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { jwtDecode } from 'jwt-decode'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import type { OAuthProvider } from '@/lib/oauth'
import { parseProvider } from '@/lib/oauth'

const logger = createLogger('OAuthConnectionsAPI')

interface GoogleIdToken {
  email?: string
  sub?: string
  name?: string
}

/**
 * Get all OAuth connections for the current user
 */
export const GET = withRouteHandler(async (request: NextRequest) => {
  const requestId = generateRequestId()

  try {
    // Get the session
    const session = await getSession()

    // Check if the user is authenticated
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthenticated request rejected`)
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    // Get all accounts for this user
    const accounts = await db.select().from(account).where(eq(account.userId, session.user.id))

    // Get the user's email for fallback
    const userRecord = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1)

    const userEmail = userRecord.length > 0 ? userRecord[0]?.email : null

    // Process accounts to determine connections
    const connections: any[] = []

    for (const acc of accounts) {
      const { baseProvider, featureType } = parseProvider(acc.providerId as OAuthProvider)
      const scopes = acc.scope ? acc.scope.split(/\s+/).filter(Boolean) : []

      if (baseProvider) {
        // Try multiple methods to get a user-friendly display name
        let displayName = ''

        // Method 1: Try to extract email from ID token (works for Google, etc.)
        if (acc.idToken) {
          try {
            const decoded = jwtDecode<GoogleIdToken>(acc.idToken)
            if (decoded.email) {
              displayName = decoded.email
            } else if (decoded.name) {
              displayName = decoded.name
            }
          } catch (_error) {
            logger.warn(`[${requestId}] Error decoding ID token`, {
              accountId: acc.id,
            })
          }
        }

        // Method 2: For GitHub, the accountId might be the username
        if (!displayName && baseProvider === 'github') {
          displayName = `${acc.accountId} (GitHub)`
        }

        // Method 3: Use the user's email from our database
        if (!displayName && userEmail) {
          displayName = userEmail
        }

        // Fallback: Use accountId with provider type as context
        if (!displayName) {
          displayName = `${acc.accountId} (${baseProvider})`
        }

        // Create a unique connection key that includes the full provider ID
        const connectionKey = acc.providerId

        // Find existing connection for this specific provider ID
        const existingConnection = connections.find((conn) => conn.provider === connectionKey)

        const accountSummary = {
          id: acc.id,
          name: displayName,
        }

        if (existingConnection) {
          // Add account to existing connection
          existingConnection.accounts = existingConnection.accounts || []
          existingConnection.accounts.push(accountSummary)

          existingConnection.scopes = Array.from(
            new Set([...(existingConnection.scopes || []), ...scopes])
          )

          const existingTimestamp = existingConnection.lastConnected
            ? new Date(existingConnection.lastConnected).getTime()
            : 0
          const candidateTimestamp = acc.updatedAt.getTime()

          if (candidateTimestamp > existingTimestamp) {
            existingConnection.lastConnected = acc.updatedAt.toISOString()
          }
        } else {
          // Create new connection
          connections.push({
            provider: connectionKey,
            baseProvider,
            featureType,
            isConnected: true,
            scopes,
            lastConnected: acc.updatedAt.toISOString(),
            accounts: [accountSummary],
          })
        }
      }
    }

    return NextResponse.json({ connections }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error fetching OAuth connections`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
})
