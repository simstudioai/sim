import { db } from '@sim/db'
import { pausedExecutions, workflowExecutionLogs } from '@sim/db/schema'
import { and, asc, desc, eq, gt, gte, lt, lte, or, sql } from 'drizzle-orm'
import { getJobQueue } from '@/lib/core/async-jobs'
import { workflowExecutionOriginSql } from '@/lib/logs/execution-origin'
import { WORKFLOW_EXECUTION_JOB_ID_PREFIX } from '@/lib/workflows/executor/execution-job-ids'

export type WorkflowExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'paused'

export interface WorkflowExecutionCursor {
  startedAt: Date
  rowId: string
}

export interface ListWorkflowExecutionsInput {
  workflowId: string
  status?: WorkflowExecutionStatus
  trigger?: string
  startDate?: Date
  endDate?: Date
  limit: number
  cursor?: WorkflowExecutionCursor
  order: 'asc' | 'desc'
}

const executionStatus = sql<string>`CASE
  WHEN ${pausedExecutions.status} IN ('paused', 'partially_resumed') THEN 'paused'
  ELSE ${workflowExecutionLogs.status}
END`

/** Lists the durable execution projection for a workflow. */
export async function listWorkflowExecutions(input: ListWorkflowExecutionsInput) {
  const cursorCondition = input.cursor
    ? input.order === 'desc'
      ? or(
          lt(workflowExecutionLogs.startedAt, input.cursor.startedAt),
          and(
            eq(workflowExecutionLogs.startedAt, input.cursor.startedAt),
            lt(workflowExecutionLogs.id, input.cursor.rowId)
          )
        )
      : or(
          gt(workflowExecutionLogs.startedAt, input.cursor.startedAt),
          and(
            eq(workflowExecutionLogs.startedAt, input.cursor.startedAt),
            gt(workflowExecutionLogs.id, input.cursor.rowId)
          )
        )
    : undefined

  const rows = await db
    .select({
      rowId: workflowExecutionLogs.id,
      executionId: workflowExecutionLogs.executionId,
      workflowId: workflowExecutionLogs.workflowId,
      status: executionStatus,
      trigger: workflowExecutionLogs.trigger,
      startedAt: workflowExecutionLogs.startedAt,
      endedAt: workflowExecutionLogs.endedAt,
      durationMs: workflowExecutionLogs.totalDurationMs,
      costTotal: workflowExecutionLogs.costTotal,
    })
    .from(workflowExecutionLogs)
    .leftJoin(pausedExecutions, eq(pausedExecutions.executionId, workflowExecutionLogs.executionId))
    .where(
      and(
        eq(workflowExecutionLogs.workflowId, input.workflowId),
        input.status ? eq(executionStatus, input.status) : undefined,
        input.trigger ? eq(workflowExecutionLogs.trigger, input.trigger) : undefined,
        input.startDate ? gte(workflowExecutionLogs.startedAt, input.startDate) : undefined,
        input.endDate ? lte(workflowExecutionLogs.startedAt, input.endDate) : undefined,
        cursorCondition
      )
    )
    .orderBy(
      input.order === 'desc'
        ? desc(workflowExecutionLogs.startedAt)
        : asc(workflowExecutionLogs.startedAt),
      input.order === 'desc' ? desc(workflowExecutionLogs.id) : asc(workflowExecutionLogs.id)
    )
    .limit(input.limit + 1)

  const hasMore = rows.length > input.limit
  const data = rows.slice(0, input.limit)
  const last = data.at(-1)
  return {
    data,
    nextCursor: hasMore && last ? { startedAt: last.startedAt, rowId: last.rowId } : null,
  }
}

export interface WorkflowExecutionOwnership {
  /** Whether the execution id really belongs to the asserted workflow. */
  belongsToWorkflow: boolean
  /**
   * Workspace of the durable log row when — and only when — the execution was
   * produced by a workflow group. `null` for a standalone run, a queue-only run
   * that has no log row yet, and a paused-only run.
   */
  workflowGroupWorkspaceId: string | null
  /**
   * Status the durable log row already carried. `null` when there is no log row
   * — a queue-only run, or a paused-only run.
   */
  priorStatus: string | null
}

/**
 * Resolves the durable and queued execution records without trusting the
 * workflow id supplied by an HTTP path. Mutating callers must use this before
 * operating on an execution id because execution ids are globally unique, not
 * nested DB keys under a workflow.
 *
 * The workflow-group origin and the row's current status both ride along on the
 * same log row the ownership check already reads. A group run owns a table cell
 * sidecar, so cancelling only the workflow log would leave the cell stuck as
 * running; and a cancel has to tell a live run apart from one that had already
 * finished. Resolving either from a second SELECT of the identical row would
 * double the read on every cancel.
 */
export async function resolveWorkflowExecutionOwnership(
  executionId: string,
  workflowId: string
): Promise<WorkflowExecutionOwnership> {
  const [logRows, pausedRows] = await Promise.all([
    db
      .select({
        workflowId: workflowExecutionLogs.workflowId,
        workspaceId: workflowExecutionLogs.workspaceId,
        status: workflowExecutionLogs.status,
        executionOrigin: workflowExecutionOriginSql(),
      })
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1),
    db
      .select({ workflowId: pausedExecutions.workflowId })
      .from(pausedExecutions)
      .where(eq(pausedExecutions.executionId, executionId))
      .limit(1),
  ])

  const logRow = logRows[0]
  const workflowGroupWorkspaceId =
    logRow?.executionOrigin === 'workflow_group' && logRow.workspaceId ? logRow.workspaceId : null

  const durableWorkflowIds = [logRow?.workflowId, pausedRows[0]?.workflowId].filter(
    (value): value is string => typeof value === 'string'
  )
  if (durableWorkflowIds.length > 0) {
    return {
      belongsToWorkflow: durableWorkflowIds.every((value) => value === workflowId),
      workflowGroupWorkspaceId,
      priorStatus: logRow?.status ?? null,
    }
  }

  const queue = await getJobQueue()
  const job = await queue.getJob(`${WORKFLOW_EXECUTION_JOB_ID_PREFIX}${executionId}`)
  return {
    belongsToWorkflow: job?.metadata.workflowId === workflowId,
    workflowGroupWorkspaceId: null,
    priorStatus: null,
  }
}
