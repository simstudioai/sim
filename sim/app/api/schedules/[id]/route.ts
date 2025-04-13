import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { workflow, workflowSchedule } from '@/db/schema'

const logger = createLogger('ScheduleDeleteAPI')

export const dynamic = 'force-dynamic'

/**
 * Delete a schedule
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = crypto.randomUUID().slice(0, 8)

  try {
    const { id } = await params
    logger.debug(`[${requestId}] Deleting schedule with ID: ${id}`)

    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized schedule deletion attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Find the schedule and check ownership
    const schedules = await db
      .select({
        schedule: workflowSchedule,
        workflow: {
          id: workflow.id,
          userId: workflow.userId,
        },
      })
      .from(workflowSchedule)
      .innerJoin(workflow, eq(workflowSchedule.workflowId, workflow.id))
      .where(eq(workflowSchedule.id, id))
      .limit(1)

    if (schedules.length === 0) {
      logger.warn(`[${requestId}] Schedule not found: ${id}`)
      return NextResponse.json({ error: 'Schedule not found' }, { status: 404 })
    }

    if (schedules[0].workflow.userId !== session.user.id) {
      logger.warn(`[${requestId}] Unauthorized schedule deletion attempt for schedule: ${id}`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    // Delete the schedule
    await db.delete(workflowSchedule).where(eq(workflowSchedule.id, id))

    logger.info(`[${requestId}] Successfully deleted schedule: ${id}`)
    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    logger.error(`[${requestId}] Error deleting schedule`, error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
