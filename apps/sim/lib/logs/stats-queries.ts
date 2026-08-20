import { dbReplica } from '@sim/db'
import { workflow, workflowExecutionLogs } from '@sim/db/schema'
import { eq, type SQL, sql } from 'drizzle-orm'

/** Oldest and newest run start in the filtered set, or nulls when it is empty. */
export interface LogStatsBounds {
  minTime: string | null
  maxTime: string | null
}

/** One `(workflow, time bucket)` group of the filtered run set. */
export interface LogStatsSegmentRow {
  workflowId: string
  workflowName: string
  segmentIndex: number
  totalExecutions: number
  successfulExecutions: number
  avgDurationMs: number
}

/**
 * The time span the filtered run set covers.
 *
 * Read separately from the segment counts because the segment width is derived
 * from the span, so the bucketing expression cannot be built until this has
 * answered.
 */
export async function readLogStatsBounds(where: SQL | undefined): Promise<LogStatsBounds> {
  const rows = await dbReplica
    .select({
      minTime: sql<string>`MIN(${workflowExecutionLogs.startedAt})`,
      maxTime: sql<string>`MAX(${workflowExecutionLogs.startedAt})`,
    })
    .from(workflowExecutionLogs)
    .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
    .where(where)

  const bounds = rows[0]
  return { minTime: bounds?.minTime ?? null, maxTime: bounds?.maxTime ?? null }
}

/**
 * Run counts, success counts, and mean duration per `(workflow, bucket)`.
 *
 * `startTimeIso` carries its `::timestamp` cast rather than arriving as a bare
 * placeholder: it is an operand of a subtraction feeding `EXTRACT`, not one side
 * of a comparison against a typed column, so Postgres has nothing to infer the
 * type from and resolves no overload without it.
 *
 * A run whose workflow has been deleted still counts — it collapses into a
 * single `'deleted'` series rather than disappearing, so the workspace totals
 * stay reconcilable against the log list.
 */
export async function readLogStatsSegments(
  where: SQL | undefined,
  startTimeIso: string,
  segmentMs: number
): Promise<LogStatsSegmentRow[]> {
  return dbReplica
    .select({
      workflowId: sql<string>`COALESCE(${workflowExecutionLogs.workflowId}, 'deleted')`,
      workflowName: sql<string>`COALESCE(${workflow.name}, 'Deleted Workflow')`,
      segmentIndex:
        sql<number>`FLOOR(EXTRACT(EPOCH FROM (${workflowExecutionLogs.startedAt} - ${startTimeIso}::timestamp)) * 1000 / ${segmentMs})`.as(
          'segment_index'
        ),
      totalExecutions: sql<number>`COUNT(*)`.as('total_executions'),
      successfulExecutions:
        sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionLogs.level} != 'error')`.as(
          'successful_executions'
        ),
      avgDurationMs:
        sql<number>`COALESCE(AVG(${workflowExecutionLogs.totalDurationMs}) FILTER (WHERE ${workflowExecutionLogs.totalDurationMs} > 0), 0)`.as(
          'avg_duration_ms'
        ),
    })
    .from(workflowExecutionLogs)
    .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
    .where(where)
    .groupBy(
      sql`COALESCE(${workflowExecutionLogs.workflowId}, 'deleted')`,
      sql`COALESCE(${workflow.name}, 'Deleted Workflow')`,
      sql`segment_index`
    )
}
