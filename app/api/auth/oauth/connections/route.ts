import { NextRequest, NextResponse } from 'next/server'
import { and, eq, like } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { account } from '@/db/schema'
import { OAuthProvider } from '@/tools/types'

// Valid OAuth providers
const VALID_PROVIDERS = ['google', 'github', 'twitter']

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
        connections.push({
          provider: provider as OAuthProvider,
          featureType,
          isConnected: true,
          scopes: acc.scope ? acc.scope.split(' ') : [],
          lastConnected: acc.updatedAt.toISOString(),
          accountId: acc.id,
        })
      }
    })

    return NextResponse.json({ connections }, { status: 200 })
  } catch (error) {
    console.error('Error fetching OAuth connections:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
