import { dbReplica, runOutsideTransactionContext } from '@sim/db'
import { activityRollupDirty, workflow, workflowActivityHourly, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { type SQL, sql } from 'drizzle-orm'
import {
  ceilHour,
  cellRuns,
  floorHour,
  HOUR_MS,
  type InstantRange,
  organizationWorkflowRuns,
  rangeRows,
  utcTimestamp,
  workflowRunCounters,
} from '@/lib/billing/activity-rollup/source'
import {
  ACTIVITY_ROLLUP_VERSION,
  type ActivityRollupState,
  readRollupState,
} from '@/lib/billing/activity-rollup/state'
import type {
  ActivityDimension,
  ActivityScope,
  ActivitySort,
  ActivityStretch,
} from '@/lib/billing/core/organization-activity'
import {
  type ActivityBreakdownPage,
  activityBreakdownKeys,
  chatActivityGroups,
  pageActivityBreakdown,
  readActivityBreakdown,
  readChatActivityDays,
} from '@/lib/billing/core/organization-activity-queries'
import { USAGE_WINDOW_MAX_DAYS } from '@/lib/billing/core/usage-analytics'
import { assertValidTimezone } from '@/lib/core/utils/timezone'
import type { DbTransaction } from '@/lib/db/types'

const logger = createLogger('OrganizationActivityRollupQueries')

/**
 * Reads use the rollup only while its newest hour is this recent: everything after it is read
 * live, and the live tail of a stalled rollup would grow without bound. The pass keeps it three
 * to four hours behind.
 */
const MAX_FRESHNESS_LAG_MS = 6 * HOUR_MS

/**
 * Reads use the rollup only while the late-end scan is this recent: a run that ends late leaves
 * its stored cell stale until the scan marks it. The scan trails now by its margin plus the time
 * between passes (longer while a heavy-hour retry holds the lease), a quarter hour at most, so
 * this bound is only crossed when the scan is failing or catching up a backlog.
 */
const MAX_LATE_END_SCAN_LAG_MS = HOUR_MS / 2

/**
 * Each marked cell is read live as its own workspace-hour; past this many in a window, those
 * reads approach the cost of the legacy read itself, so the legacy read serves instead.
 */
const MAX_LIVE_MARKED_CELLS = 5_000

/** Which part of a window the rollup serves, and the instants read live from the source. */
export interface RollupReadPlan {
  /** Whole UTC hours, all computed. */
  rollup: InstantRange | null
  /** The rest of the window, as at most two edges. */
  live: InstantRange[]
}

/**
 * Splits `window` between the rollup and the source, or returns null when the rollup must not
 * serve it at all: another version's cells, no coverage yet, a stalled pass, correction queues
 * (dirty marks and in-flight rechecks) that no pass has run lately, a late-end scan that has
 * fallen behind, or a window reaching before a
 * backfill that is still running. Once the backfill is complete, instants before the
 * coverage hold no runs and are read live at the cost of an index probe per workspace.
 */
export function planRollupRead(
  state: ActivityRollupState | null,
  window: InstantRange,
  now: Date
): RollupReadPlan | null {
  if (!state || state.version !== ACTIVITY_ROLLUP_VERSION) return null
  const { coverageStart, freshThrough } = state
  if (!coverageStart || !freshThrough) return null
  const lagging = (at: Date | null) => !at || now.getTime() - at.getTime() >= MAX_FRESHNESS_LAG_MS
  if (lagging(freshThrough) || lagging(state.correctionsAt)) return null
  const { lastEndScan } = state
  if (!lastEndScan || now.getTime() - lastEndScan.getTime() >= MAX_LATE_END_SCAN_LAG_MS) {
    return null
  }
  if (window.from < coverageStart && !state.backfillCompletedAt) return null

  const from = new Date(Math.max(ceilHour(window.from).getTime(), coverageStart.getTime()))
  const to = new Date(Math.min(floorHour(window.to).getTime(), freshThrough.getTime()))
  if (from >= to) return { rollup: null, live: [window] }
  const live: InstantRange[] = []
  if (window.from < from) live.push({ from: window.from, to: from })
  if (to < window.to) live.push({ from: to, to: window.to })
  return { rollup: { from, to }, live }
}

/**
 * Reads the state and the rows it vouches for in one snapshot of the replica, so a pass that
 * commits mid-request can never pair new progress with old cells. Null when the rollup cannot
 * serve the window, or when more of its cells are marked than are worth reading live.
 */
function readInSnapshot<T>(
  scope: ActivityScope,
  read: (tx: DbTransaction, plan: RollupReadPlan) => Promise<T>
): Promise<T | null> {
  return dbReplica.transaction(
    async (tx) => {
      const plan = planRollupRead(
        await readRollupState(tx),
        { from: scope.start, to: scope.end },
        new Date()
      )
      if (!plan) return null
      if (plan.rollup && (await exceedsLiveMarkedCells(tx, scope, plan.rollup))) {
        logger.info('Organization activity read too many marked cells; using the legacy read', {
          organizationId: scope.organizationId,
          maxLiveMarkedCells: MAX_LIVE_MARKED_CELLS,
        })
        return null
      }
      return read(tx, plan)
    },
    { isolationLevel: 'repeatable read', accessMode: 'read only' }
  )
}

/**
 * Stored cells `r` of the scope's workspaces in the rollup span, read per workspace as an
 * index-only range scan of `workflow_activity_hourly_read_idx`, the way live edges read the source.
 */
function storedCells(scope: ActivityScope, span: InstantRange): SQL {
  return sql`${workspace} w
    CROSS JOIN LATERAL (
      SELECT r.bucket_start, r.workflow_id, r.trigger, r.runs, r.completed, r.failed, r.cancelled,
        r.in_flight, r.duration_sum_ms, r.duration_count
      FROM ${workflowActivityHourly} r
      WHERE r.workspace_id = w.id
        AND r.bucket_start >= ${utcTimestamp(span.from)} AND r.bucket_start < ${utcTimestamp(span.to)}
    ) r
    WHERE w.organization_id = ${scope.organizationId}
      ${scope.workspaceId ? sql`AND w.id = ${scope.workspaceId}` : sql``}`
}

/**
 * The rollup cells of the scope's workspaces that have a pending dirty mark, as
 * `(workspace_id, h)`: known to be stale until the mark is processed (or while it backs off after
 * failing), so reads take exactly those workspace-hours live and every other workspace's stored
 * cell for the hour still serves. Read on the mark queue's key, in the read's snapshot. Each row is
 * a distinct cell: the queue's key is the workspace-hour, and each mark joins one workspace.
 */
function markedCells(scope: ActivityScope, span: InstantRange): SQL {
  return sql`SELECT d.workspace_id, d.bucket_start AS h FROM ${workspace} w
    JOIN ${activityRollupDirty} d ON d.workspace_id = w.id
      AND d.bucket_start >= ${utcTimestamp(span.from)} AND d.bucket_start < ${utcTimestamp(span.to)}
    WHERE w.organization_id = ${scope.organizationId}
      ${scope.workspaceId ? sql`AND w.id = ${scope.workspaceId}` : sql``}`
}

/**
 * Whether the scope has more than {@link MAX_LIVE_MARKED_CELLS} marked cells in `span`, reading
 * no further than one past the bound.
 */
async function exceedsLiveMarkedCells(
  tx: DbTransaction,
  scope: ActivityScope,
  span: InstantRange
): Promise<boolean> {
  const [row] = await tx.execute<{ exceeds: boolean }>(sql`
    SELECT count(*) > ${MAX_LIVE_MARKED_CELLS} AS exceeds
    FROM (${markedCells(scope, span)} LIMIT ${MAX_LIVE_MARKED_CELLS + 1}) m
  `)
  return row?.exceeds === true
}

/** A stored cell `r` of workspace `w` whose workspace-hour is not among `marked` cells `m`. */
function notMarked(marked: SQL): SQL {
  return sql`NOT EXISTS (SELECT 1 FROM (${marked}) m WHERE m.workspace_id = w.id AND m.h = r.bucket_start)`
}

type DayRow = Record<string, unknown> & {
  day: string
  runs: string | number
  completed: string | number
  failed: string | number
  in_flight: string | number
  duration_sum_ms: string | number
  duration_count: string | number
}

/**
 * Workflow activity per local day of the viewer. Stored hours are summed by the day they fall
 * on; an hour that crosses a local midnight, or a change of UTC offset, belongs to two days, so it
 * is read live with the edges instead, as is each marked cell (see {@link markedCells}). Both are found with the database's time zone rules, the
 * ones the legacy reads use. Only zones off the whole hour have such hours.
 */
async function readWorkflowDays(
  tx: DbTransaction,
  scope: ActivityScope,
  timezone: string,
  plan: RollupReadPlan
): Promise<[string, ActivityStretch][]> {
  const local = (instant: SQL) => sql`((${instant}) AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}`
  const day = (instant: SQL) => sql`to_char(date_trunc('day', ${local(instant)}), 'YYYY-MM-DD')`
  /** Parenthesized: it is subtracted below, where `- h + …` would change the arithmetic. */
  const last = sql`(h + interval '1 hour' - interval '1 microsecond')`
  const span = plan.rollup
  const straddles = span
    ? sql`SELECT h FROM generate_series(${utcTimestamp(span.from)},
          ${utcTimestamp(new Date(span.to.getTime() - HOUR_MS))}, interval '1 hour') AS h
        WHERE date_trunc('day', ${local(sql`h`)}) <> date_trunc('day', ${local(last)})
          OR ${local(sql`h`)} - h <> ${local(last)} - ${last}`
    : sql`SELECT NULL::timestamp AS h WHERE false`
  const live = sql`SELECT ${day(sql`a.started_at`)} AS day, ${workflowRunCounters}
    FROM (
      ${organizationWorkflowRuns(scope, sql`SELECT * FROM live_ranges`)}
      UNION ALL ${cellRuns(sql`SELECT * FROM marked`)}
    ) a
    GROUP BY 1`
  const stored = span
    ? sql`SELECT ${day(sql`r.bucket_start`)} AS day, sum(r.runs) AS runs,
        sum(r.completed) AS completed, sum(r.failed) AS failed, sum(r.cancelled) AS cancelled,
        sum(r.in_flight) AS in_flight, sum(r.duration_sum_ms) AS duration_sum_ms,
        sum(r.duration_count) AS duration_count
      FROM ${storedCells(scope, span)}
        AND NOT EXISTS (SELECT 1 FROM straddles s WHERE s.h = r.bucket_start)
        AND ${notMarked(sql`SELECT * FROM marked`)}
      GROUP BY 1`
    : null
  const rows = await tx.execute<DayRow>(sql`
    WITH straddles AS (${straddles}), live_ranges AS (
      ${rangeRows(plan.live)}
      UNION ALL SELECT h, h + interval '1 hour' FROM straddles
    ), marked AS (
      SELECT c.* FROM (${span ? markedCells(scope, span) : sql`SELECT NULL::text AS workspace_id, NULL::timestamp AS h WHERE false`}) c
      WHERE NOT EXISTS (SELECT 1 FROM straddles s WHERE s.h = c.h)
    )
    ${stored ? sql`${stored} UNION ALL ${live}` : live}
  `)
  return rows.map((row) => [
    row.day,
    {
      workflowRuns: Number(row.runs),
      completed: Number(row.completed),
      failed: Number(row.failed),
      durationSum: Number(row.duration_sum_ms),
      durationCount: Number(row.duration_count),
      chatRuns: 0,
      chatMembers: [],
      inFlight: Number(row.in_flight),
    },
  ])
}

/**
 * The activity summary's days with workflow runs served from the hourly rollup, or null when the
 * rollup cannot serve this window and the legacy read must. Days come as `[day, activity]`
 * entries, workflow and chat activity separately, for `summarizeActivityDays`. Chat runs are read
 * as the legacy summary reads them, through its segment cache, outside the snapshot.
 */
export async function readRollupActivityDays(
  scope: ActivityScope,
  timezone: string
): Promise<[string, ActivityStretch][] | null> {
  assertValidTimezone(timezone)
  // The legacy summary cuts a window into at most this many days; a longer one is left to it.
  if (scope.end.getTime() - scope.start.getTime() >= (USAGE_WINDOW_MAX_DAYS - 1) * 24 * HOUR_MS) {
    return null
  }
  const served = await readInSnapshot(scope, async (tx, plan) => {
    /**
     * Chats are read once the plan shows the rollup can serve, in parallel with the workflow days
     * and outside the snapshot's transaction. Marked handled at once so a snapshot that fails
     * first leaves no unhandled rejection; awaiting it below still rethrows.
     */
    const chatDays = runOutsideTransactionContext(() => timedChatDays(scope, timezone))
    chatDays.catch(() => undefined)
    return { workflowDays: await readWorkflowDays(tx, scope, timezone, plan), chatDays }
  })
  return served && [...served.workflowDays, ...(await served.chatDays)]
}

/** Logs how long the chat branch takes per request, to measure whether chats need a rollup too. */
async function timedChatDays(
  scope: ActivityScope,
  timezone: string
): Promise<[string, ActivityStretch][]> {
  const started = Date.now()
  const chatDays = await readChatActivityDays(scope, timezone)
  logger.info('Organization activity chat days read', {
    organizationId: scope.organizationId,
    durationMs: Date.now() - started,
  })
  return chatDays
}

/**
 * Workflow runs of the window as breakdown cells: stored cells summed over the rollup span, and
 * the live edges and marked cells (see {@link markedCells}), each keyed by workspace, workflow, and
 * trigger. A stored cell's workflow is looked up now, so one deleted since the cell was computed
 * reads as deleted, as its runs do.
 */
function workflowCells(scope: ActivityScope, plan: RollupReadPlan, resolveWorkflow: boolean) {
  const liveCells = (ranges: SQL) => sql`SELECT a.workspace_id, a.workflow_id, a.trigger,
      ${workflowRunCounters}
    FROM (${organizationWorkflowRuns(scope, ranges)}) a
    GROUP BY 1, 2, 3`
  if (!plan.rollup) return liveCells(rangeRows(plan.live))
  const marked = markedCells(scope, plan.rollup)
  const live = sql`${liveCells(rangeRows(plan.live))}
    UNION ALL SELECT a.workspace_id, a.workflow_id, a.trigger, ${workflowRunCounters}
    FROM (${cellRuns(marked)}) a
    GROUP BY 1, 2, 3`
  const workflowId = resolveWorkflow
    ? sql`(SELECT f.id FROM ${workflow} f WHERE f.id = nullif(r.workflow_id, ''))`
    : sql`NULL::text`
  return sql`SELECT r.workspace_id, ${workflowId} AS workflow_id,
      r.trigger, r.runs, r.completed, r.failed, r.cancelled, r.in_flight, r.duration_sum_ms,
      r.duration_count
    FROM (
      SELECT w.id AS workspace_id, r.workflow_id, r.trigger, sum(r.runs) AS runs,
        sum(r.completed) AS completed, sum(r.failed) AS failed, sum(r.cancelled) AS cancelled,
        sum(r.in_flight) AS in_flight, sum(r.duration_sum_ms) AS duration_sum_ms,
        sum(r.duration_count) AS duration_count
      FROM ${storedCells(scope, plan.rollup)}
        AND ${notMarked(marked)}
      GROUP BY 1, 2, 3
    ) r
    UNION ALL ${live}`
}

/**
 * A group's average is its summed durations over its counted runs, divided as `numeric`: the same
 * `numeric_div` of the same two integers that `avg` over the runs computes, so the figure and the
 * ranking by it are identical to the legacy read's.
 */
const aggregates = sql`
  sum(a."workflowRuns") AS "workflowRuns",
  sum(a.completed) AS completed,
  sum(a.failed) AS failed,
  sum(a."chatRuns") AS "chatRuns",
  sum(a."chatMembers") AS "chatMembers",
  sum(a."durationSum")::numeric / nullif(sum(a."durationCount"), 0)::numeric AS "averageDurationMs"
`

/**
 * The activity breakdown with workflow runs served from the hourly rollup, or null when the
 * rollup cannot serve this window and the legacy read must. One statement groups, names, ranks,
 * and pages as the legacy read does; chat runs are read live as there. Members rank chat runs
 * alone, so that dimension is the legacy read itself.
 */
export function readRollupActivityBreakdown(
  scope: ActivityScope,
  dimension: ActivityDimension,
  sort: ActivitySort,
  page: number
): Promise<ActivityBreakdownPage | null> {
  if (dimension === 'member') return readActivityBreakdown(scope, dimension, sort, page)
  return readInSnapshot(scope, (tx, plan) => {
    const keys = activityBreakdownKeys(dimension)
    const workflowGroups = sql`
      SELECT ${keys}, sum(a.runs) AS "workflowRuns", sum(a.completed) AS completed,
        sum(a.failed) AS failed, 0::bigint AS "chatRuns", 0::bigint AS "chatMembers",
        sum(a.duration_sum_ms) AS "durationSum", sum(a.duration_count) AS "durationCount"
      FROM (${workflowCells(scope, plan, dimension === 'workflow')}) a GROUP BY 1, 2
    `
    const chatGroups = chatActivityGroups(
      scope,
      keys,
      sql`NULL::numeric AS "durationSum", 0::bigint AS "durationCount"`
    )
    const activity =
      dimension === 'workspace'
        ? sql`(${workflowGroups}) UNION ALL (${chatGroups})`
        : workflowGroups
    return pageActivityBreakdown(tx, activity, aggregates, dimension, sort, page)
  })
}
