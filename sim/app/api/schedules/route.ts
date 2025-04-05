import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { eq } from 'drizzle-orm'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { workflowSchedule } from '@/db/schema'

const logger = createLogger('ScheduledAPI')

// Track recent requests to reduce redundant logging
const recentRequests = new Map<string, number>();
const LOGGING_THROTTLE_MS = 5000; // 5 seconds between logging for the same workflow

/**
 * Get schedule information for a workflow
 */
export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID().slice(0, 8)
  const url = new URL(req.url)
  const workflowId = url.searchParams.get('workflowId')
  const mode = url.searchParams.get('mode')
  
  // Skip processing if mode is provided and not 'schedule'
  if (mode && mode !== 'schedule') {
    return NextResponse.json({ schedule: null })
  }

  try {
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn(`[${requestId}] Unauthorized schedule query attempt`)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (!workflowId) {
      return NextResponse.json({ error: 'Missing workflowId parameter' }, { status: 400 })
    }

    // Check if we should log this request (throttle logging for repeat requests)
    const now = Date.now();
    const lastLog = recentRequests.get(workflowId) || 0;
    const shouldLog = now - lastLog > LOGGING_THROTTLE_MS;
    
    if (shouldLog) {
      logger.info(`[${requestId}] Getting schedule for workflow ${workflowId}`)
      recentRequests.set(workflowId, now);
    }

    // Find the schedule for this workflow
    const schedule = await db
      .select()
      .from(workflowSchedule)
      .where(eq(workflowSchedule.workflowId, workflowId))
      .limit(1)

    // Set cache control headers to reduce repeated API calls
    const headers = new Headers();
    headers.set('Cache-Control', 'max-age=30'); // Cache for 30 seconds

    if (schedule.length === 0) {
      return NextResponse.json({ schedule: null }, { headers })
    }

    return NextResponse.json({ schedule: schedule[0] }, { headers })
  } catch (error) {
    logger.error(`[${requestId}] Error retrieving workflow schedule`, error)
    return NextResponse.json({ error: 'Failed to retrieve workflow schedule' }, { status: 500 })
  }
}
