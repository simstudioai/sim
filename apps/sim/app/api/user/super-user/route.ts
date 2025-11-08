import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console/logger'
import { generateRequestId } from '@/lib/utils'

const logger = createLogger('SuperUserAPI')

export const revalidate = 0

// GET /api/user/super-user - Check if current user is a super user (database status)
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized super user status check attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const currentUser = await db
      .select({ isSuperUser: user.isSuperUser })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1)

    if (currentUser.length === 0) {
      logger.warn(`[${requestId}] User not found: ${session.user.id}`)
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    return NextResponse.json({
      isSuperUser: currentUser[0].isSuperUser,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error checking super user status`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
