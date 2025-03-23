import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { workflowSchedule } from '@/db/schema'

const logger = createLogger('Scheduled API')

/**
 * Get schedule information for a workflow
 */
export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const url = new URL(req.url)
  const workflowId = url.searchParams.get('workflowId')

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized schedule query attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!workflowId) {
      return NextResponse.json({ error: 'Missing workflowId parameter' }, { status: 400 })
    }

    logger.info(`[${requestId}] Getting schedule for workflow ${workflowId}`)

    // Find the schedule for this workflow
    const schedule = await db
      .select()
      .from(workflowSchedule)
      .where(eq(workflowSchedule.workflowId, workflowId))
      .limit(1)

    if (schedule.length === 0) {
      return NextResponse.json({ schedule: null })
    }

    return NextResponse.json({ schedule: schedule[0] })
  } catch (error) {
    logger.error(`[${requestId}] Error retrieving workflow schedule`, error)
    return NextResponse.json({ error: 'Failed to retrieve workflow schedule' }, { status: 500 })
  }
}
