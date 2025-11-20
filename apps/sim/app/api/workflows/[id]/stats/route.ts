import { db } from '@sim/db'
import { userStats, workflow } from '@sim/db/schema'
import { eq, sql } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('WorkflowStatsAPI')

const queryParamsSchema = z.object({
  runs: z.coerce.number().int().min(1).max(100).default(1),
})

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const searchParams = request.nextUrl.searchParams

  const validation = queryParamsSchema.safeParse({
    runs: searchParams.get('runs'),
  })

  if (!validation.success) {
    logger.error(`Invalid query parameters: ${validation.error.message}`)
    return NextResponse.json(
      {
        error:
          validation.error.errors[0]?.message ||
          'Invalid number of runs. Must be between 1 and 100.',
      },
      { status: 400 }
    )
  }

  const { runs } = validation.data

  try {
    const [workflowRecord] = await db.select().from(workflow).where(eq(workflow.id, id)).limit(1)

    if (!workflowRecord) {
      return NextResponse.json({ error: `Workflow ${id} not found` }, { status: 404 })
    }

    try {
      await db
        .update(workflow)
        .set({
          runCount: workflowRecord.runCount + runs,
          lastRunAt: new Date(),
        })
        .where(eq(workflow.id, id))
    } catch (error) {
      logger.error('Error updating workflow runCount:', error)
      throw error
    }

    try {
      const userStatsRecords = await db
        .select()
        .from(userStats)
        .where(eq(userStats.userId, workflowRecord.userId))

      if (userStatsRecords.length === 0) {
        await db.insert(userStats).values({
          id: crypto.randomUUID(),
          userId: workflowRecord.userId,
          totalManualExecutions: 0,
          totalApiCalls: 0,
          totalWebhookTriggers: 0,
          totalScheduledExecutions: 0,
          totalChatExecutions: 0,
          totalTokensUsed: 0,
          totalCost: '0.00',
          lastActive: sql`now()`,
        })
      } else {
        await db
          .update(userStats)
          .set({
            lastActive: sql`now()`,
          })
          .where(eq(userStats.userId, workflowRecord.userId))
      }
    } catch (error) {
      logger.error(`Error ensuring userStats for userId ${workflowRecord.userId}:`, error)
      // Don't rethrow - we want to continue even if this fails
    }

    return NextResponse.json({
      success: true,
      runsAdded: runs,
      newTotal: workflowRecord.runCount + runs,
    })
  } catch (error) {
    logger.error('Error updating workflow stats:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
