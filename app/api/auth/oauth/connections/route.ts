import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { jwtDecode } from 'jwt-decode'
import { getSession } from '@/lib/auth'
import { OAuthService } from '@/lib/oauth'
import { db } from '@/db'
import { account } from '@/db/schema'

interface GoogleIdToken {
  email?: string
  sub?: string
}

// Valid OAuth providers
const VALID_PROVIDERS = ['google', 'github', 'x']

/**
 * Get all OAuth connections for the current user
 */
export async function GET(request: NextRequest) {
  try {
    // Get the session
    const session = await getSession()

    // Check if the user is authenticated
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    // Get all accounts for this user
    const accounts = await db.select().from(account).where(eq(account.userId, session.user.id))

    // Process accounts to determine connections
    const connections: any[] = []

    accounts.forEach((acc) => {
      // Extract the base provider and feature type from providerId (e.g., 'google-email' -> 'google', 'email')
      const [provider, featureType = 'default'] = acc.providerId.split('-')

      if (provider && VALID_PROVIDERS.includes(provider)) {
        // Get the account name (try to get email for Google accounts)
        let name = acc.accountId
        if (provider === 'google' && acc.idToken) {
          try {
            const decoded = jwtDecode<GoogleIdToken>(acc.idToken)
            if (decoded.email) {
              name = decoded.email
            }
          } catch (error) {
            console.error('Error decoding ID token:', error)
          }
        }

        // Find existing connection for this provider and feature type
        const existingConnection = connections.find(
          (conn) => conn.provider === provider && conn.featureType === featureType
        )

        if (existingConnection) {
          // Add account to existing connection
          existingConnection.accounts = existingConnection.accounts || []
          existingConnection.accounts.push({
            id: acc.id,
            name,
          })
        } else {
          // Create new connection
          connections.push({
            provider: provider as OAuthService,
            featureType,
            isConnected: true,
            scopes: acc.scope ? acc.scope.split(' ') : [],
            lastConnected: acc.updatedAt.toISOString(),
            accounts: [
              {
                id: acc.id,
                name,
              },
            ],
          })
        }
      }
    })

    return NextResponse.json({ connections }, { status: 200 })
  } catch (error) {
    console.error('Error fetching OAuth connections:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
