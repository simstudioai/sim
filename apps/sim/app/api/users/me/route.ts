import { db } from '@sim/db'
import { user, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, ne, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { generateRequestId } from '@/lib/core/utils/request'
import { captureServerEvent } from '@/lib/posthog/server'

const logger = createLogger('DeleteUserAPI')

export const dynamic = 'force-dynamic'

export async function DELETE() {
  const requestId = generateRequestId()

  try {
    const session = await getSession()

    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized account deletion attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    captureServerEvent(userId, 'user_deleted', {})

    await db.transaction(async (tx) => {
      await tx
        .update(workspace)
        .set({ billedAccountUserId: sql`owner_id` })
        .where(and(eq(workspace.billedAccountUserId, userId), ne(workspace.ownerId, userId)))

      await tx.delete(workspace).where(eq(workspace.ownerId, userId))

      await tx.delete(user).where(eq(user.id, userId))
    })

    logger.info(`[${requestId}] User account deleted`, { userId })

    return NextResponse.json({ success: true })
  } catch (error) {
    logger.error(`[${requestId}] Account deletion error`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
