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

    const response = await fetch(`/api/workflows/${workflowId}/stats?runs=${runs}`, {
      method: 'POST',
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.error || 'Failed to update workflow stats')
    }

    return response.json()
  } catch (error) {
    logger.error(`Error updating workflow run counts:`, error)
    throw error
  }
}
