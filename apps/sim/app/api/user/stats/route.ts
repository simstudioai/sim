import { NextRequest, NextResponse } from 'next/server'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { userStats, workflow } from '@/db/schema'

const logger = createLogger('UserStatsAPI')

/**
 * GET endpoint to retrieve user statistics including the count of workflows
 */
export async function GET(request: NextRequest) {
  try {
    // Get the user session
    const session = await getSession()
    if (!session?.user?.id) {
      logger.warn('Unauthorized user stats access attempt')
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    // Get workflow count for user
    const [workflowCountResult] = await db
      .select({ count: sql`count(*)::int` })
      .from(workflow)
      .where(eq(workflow.userId, userId))

    const workflowCount = workflowCountResult?.count || 0

    // Get user stats record
    const userStatsRecords = await db.select().from(userStats).where(eq(userStats.userId, userId))

    // If no stats record exists, create one
    if (userStatsRecords.length === 0) {
      const newStats = {
        id: crypto.randomUUID(),
        userId,
        totalManualExecutions: 0,
        totalApiCalls: 0,
        totalWebhookTriggers: 0,
        totalScheduledExecutions: 0,
        totalChatExecutions: 0,
        totalTokensUsed: 0,
        totalCost: '0.00',
        lastActive: new Date(),
      }

      await db.insert(userStats).values(newStats)

      // Return the newly created stats with workflow count
      return NextResponse.json({
        ...newStats,
        workflowCount,
      })
    }

    // Return stats with workflow count
    const stats = userStatsRecords[0]
    return NextResponse.json({
      ...stats,
      workflowCount,
    })
  } catch (error) {
    logger.error('Error fetching user stats:', error)
    return NextResponse.json({ error: 'Failed to fetch user statistics' }, { status: 500 })
  }
}
