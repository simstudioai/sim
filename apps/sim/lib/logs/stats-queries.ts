import { dbReplica } from '@sim/db'
import { workflow, workflowExecutionLogs } from '@sim/db/schema'
import { chunkArray } from '@sim/utils/helpers'
import { eq, inArray, type SQL, sql } from 'drizzle-orm'
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
   * Whether `where` references the `workflow` table (a folder, workflow-id, or
   * workflow-name filter), so the read must join it. Leave it off otherwise:
   * the join is what forces a full `workflow` scan and a heap fetch per log
   * row. Off with a `workflow` predicate in `where` fails loudly with a
   * missing FROM-clause error rather than reading the wrong rows.
   */
  joinsWorkflow: boolean
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

/** Keeps the name lookup's `IN` list far below the protocol's bind-parameter ceiling. */
const WORKFLOW_NAME_LOOKUP_BATCH = 1000

/**
 * Run counts, success counts, and mean duration per `(workflow, bucket)`.
 *
 * `startTimeIso` carries its `::timestamp` cast rather than arriving as a bare
 * placeholder: it is an operand of a subtraction feeding `EXTRACT`, not one side
 * of a comparison against a typed column, so Postgres has nothing to infer the
 * type from and resolves no overload without it.
 *
 * Grouped by the log's own `workflow_id`, with names resolved afterwards by
 * primary key for just the workflows that appear. A name is a function of the
 * id, so this yields the same groups as grouping by both, without reading the
 * `workflow` table once per log row. Every id's name is resolved, not only the
 * series `maxWorkflows` keeps, because the cut orders ties by name.
 *
 * A run whose workflow has been deleted still counts — it collapses into a
 * single `'deleted'` series rather than disappearing, so the workspace totals
 * stay reconcilable against the log list.
 */
export async function readLogStatsSegments(
  where: SQL | undefined,
  startTimeIso: string,
  segmentMs: number,
  options: ReadLogStatsSegmentsOptions
): Promise<LogStatsSegmentRow[]> {
  const query = dbReplica
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

  const rows = await (options.joinsWorkflow
    ? query
        .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
        .where(where)
        .groupBy(workflowExecutionLogs.workflowId, sql`segment_index`)
    : query.where(where).groupBy(workflowExecutionLogs.workflowId, sql`segment_index`))

  const names = await readWorkflowNames(rows)
  return rows.map(({ workflowId, ...row }) => ({
    ...row,
    workflowId: workflowId ?? 'deleted',
    workflowName:
      workflowId === null
        ? DELETED_WORKFLOW_LABEL
        : (names.get(workflowId) ?? DELETED_WORKFLOW_LABEL),
  }))
}

/** Names of the workflows the grouped rows reference; an id with no row is absent. */
async function readWorkflowNames(
  rows: ReadonlyArray<{ workflowId: string | null }>
): Promise<Map<string, string>> {
  const ids = new Set<string>()
  for (const row of rows) {
    if (row.workflowId !== null) ids.add(row.workflowId)
  }

  const names = new Map<string, string>()
  for (const batch of chunkArray([...ids], WORKFLOW_NAME_LOOKUP_BATCH)) {
    const found = await dbReplica
      .select({ id: workflow.id, name: workflow.name })
      .from(workflow)
      .where(inArray(workflow.id, batch))
    for (const { id, name } of found) names.set(id, name)
  }
  return names
}
