import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { workflow as workflowTable } from '@/db/schema'

export async function getWorkflowById(id: string) {
  const workflows = await db.select().from(workflowTable).where(eq(workflowTable.id, id)).limit(1)
  return workflows[0]
}

export async function updateWorkflowRunCounts(workflowId: string, runs: number = 1) {
  const response = await fetch(`/api/workflows/${workflowId}/stats?runs=${runs}`, {
    method: 'POST',
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to update workflow stats')
  }

  return response.json()
}
