import { workflowExecutionLogs, workspace } from '@sim/db/schema'
import { type SQL, sql } from 'drizzle-orm'

/**
 * The SQL every activity rollup read and write takes from `workflow_execution_logs`, so a cell the
 * pass stores and a range a request reads live always count runs the same way. The definitions
 * are the legacy activity queries' (`organization-activity-queries.ts`), which the rollup must
 * reproduce exactly.
 */

/** A half-open span of instants. */
export interface InstantRange {
  from: Date
  to: Date
}

export const HOUR_MS = 60 * 60 * 1000

/**
 * How long after an hour ends before it is computed. A run that ends within two hours of its start
 * (the predicate of `workflow_execution_logs_late_end_idx`) has ended by then; one that ends later
 * is found by its late end, or marked when its end commits. The hour of margin covers commit and
 * replica lag, so this must stay at least an hour above that threshold.
 */
export const ACTIVITY_ROLLUP_SETTLE_MS = 3 * HOUR_MS

/** An instant as the UTC wall clock `started_at` stores, whatever the session's time zone. */
export function utcTimestamp(instant: Date): SQL {
  return sql`(${instant.toISOString()}::timestamptz AT TIME ZONE 'UTC')`
}

/** A duration as a SQL `interval`. */
export function msInterval(ms: number): SQL {
  return sql`${`${ms} milliseconds`}::interval`
}

/** A source row `l` as activity reads it: only finished runs carry a duration, never a negative one. */
const workflowRunColumns = sql`l.workspace_id, l.workflow_id, l.trigger, l.started_at, l.status,
  CASE WHEN l.status IN ('completed', 'failed') AND l.total_duration_ms >= 0
    THEN l.total_duration_ms END AS duration_ms`

/**
 * A cell's counters over runs `a` as {@link workflowRunColumns} projects them. Unfinished runs are
 * every status but the three terminal ones.
 */
export const workflowRunCounters = sql`count(*) AS runs,
  count(*) FILTER (WHERE a.status = 'completed') AS completed,
  count(*) FILTER (WHERE a.status = 'failed') AS failed,
  count(*) FILTER (WHERE a.status = 'cancelled') AS cancelled,
  count(*) FILTER (WHERE a.status NOT IN ('completed', 'failed', 'cancelled')) AS in_flight,
  coalesce(sum(a.duration_ms), 0) AS duration_sum_ms,
  count(a.duration_ms) AS duration_count`

/**
 * Every run that started in `range`, for recomputing cells. With `workspaceIds`, each workspace is
 * read on its own through `workflow_execution_logs_workspace_activity_level_idx`, so a page of
 * workspaces never falls back to scanning the whole range on `started_at`.
 */
export function workflowRunsStartedIn(range: InstantRange, workspaceIds?: string[]): SQL {
  const inRange = sql`l.started_at >= ${utcTimestamp(range.from)} AND l.started_at < ${utcTimestamp(range.to)}`
  if (!workspaceIds) {
    return sql`SELECT ${workflowRunColumns} FROM ${workflowExecutionLogs} l WHERE ${inRange}`
  }
  const ids = sql.join(
    workspaceIds.map((id) => sql`(${id})`),
    sql`, `
  )
  return sql`SELECT l.* FROM (VALUES ${ids}) AS p(workspace_id)
    CROSS JOIN LATERAL (
      SELECT ${workflowRunColumns} FROM ${workflowExecutionLogs} l
      WHERE l.workspace_id = p.workspace_id AND ${inRange}
    ) l`
}

/**
 * The runs of an organization's workspaces (or one of them) that started in any range `ranges`
 * returns as `(range_start, range_end)` rows, which must not overlap. Each workspace is read on its
 * own through `workflow_execution_logs_workspace_activity_level_idx`, which holds every column
 * projected, so a live edge of a large organization's window is a set of index-only range scans
 * rather than a scan of every run in the span. Like the legacy reads, a workspace belongs to the
 * organization it belongs to now.
 */
export function organizationWorkflowRuns(
  scope: { organizationId: string; workspaceId?: string },
  ranges: SQL
): SQL {
  return sql`SELECT l.* FROM ${workspace} w
    CROSS JOIN (${ranges}) rg
    CROSS JOIN LATERAL (
      SELECT ${workflowRunColumns} FROM ${workflowExecutionLogs} l
      WHERE l.workspace_id = w.id
        AND l.started_at >= rg.range_start AND l.started_at < rg.range_end
    ) l
    WHERE w.organization_id = ${scope.organizationId}
      ${scope.workspaceId ? sql`AND w.id = ${scope.workspaceId}` : sql``}`
}

/**
 * The runs of the workspace-hour cells `cells` returns as `(workspace_id, h)` rows, each read on the
 * workspace activity index, for reading single stale cells live.
 */
export function cellRuns(cells: SQL): SQL {
  return sql`SELECT l.* FROM (${cells}) c
    CROSS JOIN LATERAL (
      SELECT ${workflowRunColumns} FROM ${workflowExecutionLogs} l
      WHERE l.workspace_id = c.workspace_id
        AND l.started_at >= c.h AND l.started_at < c.h + interval '1 hour'
    ) l`
}

/** `ranges` as `(range_start, range_end)` rows for {@link organizationWorkflowRuns}. */
export function rangeRows(ranges: InstantRange[]): SQL {
  if (ranges.length === 0) {
    return sql`SELECT NULL::timestamp AS range_start, NULL::timestamp AS range_end WHERE false`
  }
  const rows = ranges.map((range) => sql`(${utcTimestamp(range.from)}, ${utcTimestamp(range.to)})`)
  return sql`SELECT * FROM (VALUES ${sql.join(rows, sql`, `)}) AS v(range_start, range_end)`
}

export function floorHour(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / HOUR_MS) * HOUR_MS)
}

export function ceilHour(instant: Date): Date {
  return new Date(Math.ceil(instant.getTime() / HOUR_MS) * HOUR_MS)
}
