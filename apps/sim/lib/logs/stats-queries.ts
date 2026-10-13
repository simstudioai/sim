import { dbReplica } from '@sim/db'
import { workflow, workflowExecutionLogs } from '@sim/db/schema'
import { eq, type SQL, sql } from 'drizzle-orm'
import { handledErrorSpanCondition } from '@/lib/logs/handled-errors'
import { DELETED_WORKFLOW_LABEL } from '@/lib/workflows/workflow-labels'

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
  /** Runs holding a handled block error. Always 0 unless the read counted them. */
  handledErrorRuns: number
}

export interface ReadLogStatsSegmentsOptions {
  /**
   * Whether to count runs with a handled block error per bucket. Opt-in: it
   * scans each run's stored execution data, so it is paid only when asked for.
   */
  countHandledErrors?: boolean
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
 * Groups by the log's own `workflow_id`, then joins `workflow` once per group
 * for its name, in the same statement. A name is a function of the id, so this
 * yields the same groups as grouping by both without carrying name text through
 * the aggregate. The subquery's LEFT join to `workflow` serves only the filters
 * that reference it; Postgres removes it when nothing does.
 *
 * A run whose workflow has been deleted still counts — it collapses into a
 * single `'deleted'` series rather than disappearing, so the workspace totals
 * stay reconcilable against the log list.
 */
export async function readLogStatsSegments(
  where: SQL | undefined,
  startTimeIso: string,
  segmentMs: number,
  options: ReadLogStatsSegmentsOptions = {}
): Promise<LogStatsSegmentRow[]> {
  const grouped = dbReplica
    .select({
      handledErrorRuns: (options.countHandledErrors
        ? sql<number>`COUNT(*) FILTER (WHERE ${handledErrorSpanCondition()})`
        : sql<number>`0`
      ).as('handled_error_runs'),
      workflowId: workflowExecutionLogs.workflowId,
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
    .groupBy(workflowExecutionLogs.workflowId, sql`segment_index`)
    .as('grouped')

  return dbReplica
    .select({
      handledErrorRuns: grouped.handledErrorRuns,
      workflowId: sql<string>`COALESCE(${grouped.workflowId}, 'deleted')`,
      workflowName: sql<string>`COALESCE(${workflow.name}, ${DELETED_WORKFLOW_LABEL})`,
      segmentIndex: grouped.segmentIndex,
      totalExecutions: grouped.totalExecutions,
      successfulExecutions: grouped.successfulExecutions,
      avgDurationMs: grouped.avgDurationMs,
    })
    .from(grouped)
    .leftJoin(workflow, eq(grouped.workflowId, workflow.id))
}
