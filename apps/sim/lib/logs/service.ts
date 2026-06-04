import { db } from '@sim/db'
import { workflow, workflowExecutionLogs } from '@sim/db/schema'
import { eq } from 'drizzle-orm'

/** Minimal log record returned by server-side service lookups. */
export interface LogRecord {
  id: string
  workspaceId: string
  startedAt: Date
  workflowName: string | null
}

/**
 * Fetches a log record by its primary key, joining the workflow name.
 * Returns null if no matching record exists.
 */
export async function getLogById(id: string): Promise<LogRecord | null> {
  const [record] = await db
    .select({
      id: workflowExecutionLogs.id,
      workspaceId: workflowExecutionLogs.workspaceId,
      startedAt: workflowExecutionLogs.startedAt,
      workflowName: workflow.name,
    })
    .from(workflowExecutionLogs)
    .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
    .where(eq(workflowExecutionLogs.id, id))
    .limit(1)

  return record ?? null
}
