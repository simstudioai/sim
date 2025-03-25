import { eq } from 'drizzle-orm'
import { createLogger } from '@/lib/logs/console-logger'
import { db } from '@/db'
import { userStats, workflow as workflowTable } from '@/db/schema'

const logger = createLogger('WorkflowUtils')

export async function getWorkflowById(id: string) {
  const workflows = await db.select().from(workflowTable).where(eq(workflowTable.id, id)).limit(1)
  return workflows[0]
}

export async function updateWorkflowRunCounts(workflowId: string, runs: number = 1) {
  try {
    const workflow = await getWorkflowById(workflowId)
    if (!workflow) {
      logger.error(`Workflow ${workflowId} not found`)
      throw new Error(`Workflow ${workflowId} not found`)
    }

    // Get the origin from the environment or use direct DB update as fallback
    const origin =
      process.env.NEXT_PUBLIC_APP_URL ||
      (typeof window !== 'undefined' ? window.location.origin : '')

    if (origin) {
      // Use absolute URL with origin
      const response = await fetch(`${origin}/api/workflows/${workflowId}/stats?runs=${runs}`, {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update workflow stats')
      }

      return response.json()
    } else {
      logger.warn(`No origin available, updating workflow stats directly via DB`)

      // Update workflow directly through database
      await db
        .update(workflowTable)
        .set({
          runCount: workflow.runCount + runs,
          lastRunAt: new Date(),
        })
        .where(eq(workflowTable.id, workflowId))

      // Update user stats if needed
      if (workflow.userId) {
        const userStatsRecord = await db
          .select()
          .from(userStats)
          .where(eq(userStats.userId, workflow.userId))
          .limit(1)

        if (userStatsRecord.length === 0) {
          // Create new record
          await db.insert(userStats).values({
            id: crypto.randomUUID(),
            userId: workflow.userId,
            totalManualExecutions: runs,
            totalApiCalls: 0,
            totalWebhookTriggers: 0,
            totalScheduledExecutions: 0,
            totalTokensUsed: 0,
            totalCost: '0.00',
            lastActive: new Date(),
          })
        } else {
          // Update existing record
          await db
            .update(userStats)
            .set({
              totalManualExecutions: userStatsRecord[0].totalManualExecutions + runs,
              lastActive: new Date(),
            })
            .where(eq(userStats.userId, workflow.userId))
        }
      }

      return { success: true, runsAdded: runs }
    }
  } catch (error) {
    logger.error(`Error updating workflow run counts:`, error)
    throw error
  }
}
