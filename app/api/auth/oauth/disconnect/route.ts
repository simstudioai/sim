import { NextRequest, NextResponse } from 'next/server'
import { and, eq, like } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { db } from '@/db'
import { account } from '@/db/schema'
import { OAuthProvider } from '@/tools/types'

/**
 * Disconnect an OAuth provider for the current user
 */
export async function POST(request: NextRequest) {
  try {
    // Get the session
    const session = await getSession()

    // Check if the user is authenticated
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'User not authenticated' }, { status: 401 })
    }

    // Get the provider and providerId from the request body
    const { provider, providerId } = await request.json()

    if (!provider) {
      return NextResponse.json({ error: 'Provider is required' }, { status: 400 })
    }

    // If a specific providerId is provided, delete only that account
    if (providerId) {
      await db
        .delete(account)
        .where(and(eq(account.userId, session.user.id), eq(account.providerId, providerId)))
    } else {
      // Otherwise, delete all accounts for this provider
      // We use LIKE to match all feature types (e.g., google-default, google-email, etc.)
      await db
        .delete(account)
        .where(and(eq(account.userId, session.user.id), like(account.providerId, `${provider}-%`)))
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    console.error('Error disconnecting OAuth provider:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
