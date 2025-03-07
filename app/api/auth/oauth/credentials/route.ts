import { NextRequest, NextResponse } from 'next/server'
import { and, eq, like } from 'drizzle-orm'
import { jwtDecode } from 'jwt-decode'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { account } from '@/db/schema'
import { OAuthProvider } from '@/tools/types'

interface GoogleIdToken {
  email?: string
  sub?: string
}

/**
 * Get credentials for a specific provider
 */
export async function GET(request: NextRequest) {
  try {
    // Get the session
    const session = await getSession()

    // Check if the user is authenticated
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    // Get the provider from the query params
    const { searchParams } = new URL(request.url)
    const provider = searchParams.get('provider') as OAuthProvider | null

    if (!provider) {
      return NextResponse.json({ error: 'Provider is required' }, { status: 400 })
    }

    // Get all accounts for this user and provider
    const accounts = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, session.user.id), like(account.providerId, `${provider}-%`)))

    // Transform accounts into credentials
    const credentials = await Promise.all(
      accounts.map(async (acc) => {
        // Extract the feature type from providerId (e.g., 'google-default' -> 'default')
        const [_, featureType = 'default'] = acc.providerId.split('-')

        // For Google accounts, try to get the email from the ID token
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
    console.error('Error fetching credentials:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
