import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'

const logger = createLogger('AuthAccountsAPI')

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const provider = searchParams.get('provider')

    const whereConditions = [eq(account.userId, session.user.id)]

    if (provider) {
      whereConditions.push(eq(account.providerId, provider))
    }

    const accounts = await db
      .select({
        id: account.id,
        accountId: account.accountId,
        providerId: account.providerId,
      })
      .from(account)
      .where(and(...whereConditions))

    // Use the user's email as the display name (consistent with credential selector)
    const userEmail = session.user.email

    const accountsWithDisplayName = accounts.map((acc) => ({
      id: acc.id,
      accountId: acc.accountId,
      providerId: acc.providerId,
      displayName: userEmail || acc.providerId,
    }))

    return NextResponse.json({ accounts: accountsWithDisplayName })
  } catch (error) {
    logger.error('Failed to fetch accounts', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
