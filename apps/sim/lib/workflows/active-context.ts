import { db } from '@sim/db'
import { workflow, workspace } from '@sim/db/schema'
import { and, eq, isNull } from 'drizzle-orm'

export type ActiveWorkflowRecord = typeof workflow.$inferSelect

export interface ActiveWorkflowContext {
  workflow: ActiveWorkflowRecord
  workspaceId: string
}

/**
 * Returns the workflow and workspace context only when both are still active.
 */
export async function getActiveWorkflowContext(
  workflowId: string
): Promise<ActiveWorkflowContext | null> {
  const rows = await db
    .select({
      workflow,
      workspaceId: workspace.id,
    })
    .from(workflow)
    .innerJoin(workspace, eq(workflow.workspaceId, workspace.id))
    .where(
      and(eq(workflow.id, workflowId), isNull(workflow.archivedAt), isNull(workspace.archivedAt))
    )
    .limit(1)

  if (rows.length === 0) {
    return null
  }

  return {
    workflow: rows[0].workflow,
    workspaceId: rows[0].workspaceId,
  }
}

/**
 * Returns the workflow row only when its parent workspace is also active.
 */
export async function getActiveWorkflowRecord(
  workflowId: string
): Promise<ActiveWorkflowRecord | null> {
  const context = await getActiveWorkflowContext(workflowId)
  return context?.workflow ?? null
}

export async function assertActiveWorkflowContext(
  workflowId: string
): Promise<ActiveWorkflowContext> {
  const context = await getActiveWorkflowContext(workflowId)
  if (!context) {
    throw new Error(`Active workflow not found: ${workflowId}`)
  }
  return context
}
