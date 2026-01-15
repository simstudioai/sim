import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'

const logger = createLogger('AdminStatusAPI')

export const revalidate = 0

/**
 * GET /api/user/admin-status - Check if current user has admin privileges
 * Returns hasAdminPrivileges: true if user role is 'admin' or 'superadmin'
 */
export async function GET(request: NextRequest) {
  const requestId = generateRequestId()

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized admin status check attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const currentUser = await db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1)

    if (currentUser.length === 0) {
      logger.warn(`[${requestId}] User not found: ${session.user.id}`)
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const role = currentUser[0].role
    return NextResponse.json({
      hasAdminPrivileges: role === 'admin' || role === 'superadmin',
      role,
    })
  } catch (error) {
    logger.error(`[${requestId}] Error checking admin status`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
