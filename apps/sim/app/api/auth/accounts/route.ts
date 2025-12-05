import { db } from '@sim/db'
import { account } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'

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

    return NextResponse.json({ accounts })
  } catch (error) {
    logger.error('Failed to fetch accounts', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
