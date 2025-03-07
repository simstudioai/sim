import { NextRequest, NextResponse } from 'next/server'
import { and, eq, like } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { account } from '@/db/schema'
import { OAuthProvider } from '@/tools/types'

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
    const credentials = accounts.map((acc) => {
      // Extract the feature type from providerId (e.g., 'google-default' -> 'default')
      const [_, featureType = 'default'] = acc.providerId.split('-')

      return {
        id: acc.id,
        name: `${provider.charAt(0).toUpperCase() + provider.slice(1)} ${featureType !== 'default' ? featureType : ''}`.trim(),
        provider,
        lastUsed: acc.updatedAt.toISOString(),
        isDefault: featureType === 'default',
      }
    })

    return NextResponse.json({ credentials }, { status: 200 })
  } catch (error) {
    console.error('Error fetching credentials:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
