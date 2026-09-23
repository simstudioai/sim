import { dbReplica } from '@sim/db'
import {
  copilotChats,
  copilotRuns,
  user,
  workflow,
  workflowExecutionLogs,
  workspace,
} from '@sim/db/schema'
import { and, eq, type SQL, sql } from 'drizzle-orm'
import {
  ACTIVITY_PAGE_SIZE,
  type ActivityAggregate,
  type ActivityDimension,
  type ActivityScope,
  type ActivitySort,
  type ActivityStretch,
  activityMetrics,
  combineActivity,
  EMPTY_ACTIVITY_STRETCH,
} from '@/lib/billing/core/organization-activity'
import { usageWindowSegments } from '@/lib/billing/core/usage-analytics'
import { readThroughSegments } from '@/lib/billing/core/usage-segment-cache'
import { assertValidTimezone } from '@/lib/core/utils/timezone'

export async function readActivityWorkspace(organizationId: string, workspaceId: string) {
  const [row] = await dbReplica
    .select({ id: workspace.id, name: workspace.name })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), eq(workspace.organizationId, organizationId)))
    .limit(1)
  return row ?? null
}

/**
 * Scope by the owning workspace or organization chat, never the user's memberships.
 * Only lightweight execution columns are read; transcripts and trace payloads stay private.
 * Chat continuations share an execution id and belong to their first retained start.
 */
function activitySources(scope: ActivityScope) {
  const start = sql`(${scope.start.toISOString()}::timestamptz AT TIME ZONE 'UTC')`
  const end = sql`(${scope.end.toISOString()}::timestamptz AT TIME ZONE 'UTC')`
  const workflows = sql`
    SELECT l.workspace_id, l.workflow_id,
      l.trigger, l.started_at, l.status,
      CASE WHEN l.status IN ('completed', 'failed') AND l.total_duration_ms >= 0
        THEN l.total_duration_ms END AS duration_ms
    FROM ${workflowExecutionLogs} l
    JOIN ${workspace} w ON w.id = l.workspace_id
    WHERE w.organization_id = ${scope.organizationId}
      AND l.started_at >= ${start} AND l.started_at < ${end}
      ${scope.workspaceId ? sql`AND l.workspace_id = ${scope.workspaceId}` : sql``}
  `
  /** Separate ownership branches let Postgres use the workspace and organization chat indexes. */
  const workspaceChats = sql`
    SELECT c.id, c.workspace_id FROM ${copilotChats} c
    JOIN ${workspace} w ON w.id = c.workspace_id
    WHERE w.organization_id = ${scope.organizationId}
      ${scope.workspaceId ? sql`AND c.workspace_id = ${scope.workspaceId}` : sql``}
  `
  const scopedChats = scope.workspaceId
    ? workspaceChats
    : sql`${workspaceChats} UNION ALL
        SELECT c.id, c.workspace_id FROM ${copilotChats} c
        WHERE c.organization_id = ${scope.organizationId}`
  const chats = sql`
    SELECT DISTINCT ON (r.execution_id)
      c.workspace_id, r.user_id AS member_id, r.started_at
    FROM ${copilotRuns} r
    JOIN (${scopedChats}) c ON c.id = r.chat_id
    WHERE r.started_at >= ${start} AND r.started_at < ${end}
      AND NOT EXISTS (
        SELECT 1 FROM ${copilotRuns} earlier
        WHERE earlier.execution_id = r.execution_id AND earlier.started_at < ${start}
      )
    ORDER BY r.execution_id, r.started_at, r.id
  `
  return { workflows, chats }
}

function activityGroups(scope: ActivityScope, keys: SQL, dimension?: ActivityDimension) {
  const { workflows, chats } = activitySources(scope)
  const workflowGroups = sql`
    SELECT ${keys}, count(*) AS "workflowRuns",
      count(*) FILTER (WHERE a.status = 'completed') AS completed,
      count(*) FILTER (WHERE a.status = 'failed') AS failed,
      0::bigint AS "chatRuns", 0::bigint AS "chatMembers",
      avg(a.duration_ms) AS "averageDurationMs"
    FROM (${workflows}) a GROUP BY 1, 2
  `
  const chatGroups = sql`
    SELECT ${keys}, 0::bigint AS "workflowRuns", 0::bigint AS completed, 0::bigint AS failed,
      count(*) AS "chatRuns", count(DISTINCT a.member_id) AS "chatMembers",
      NULL::numeric AS "averageDurationMs"
    FROM (${chats}) a GROUP BY 1, 2
  `
  if (dimension === 'member') return chatGroups
  if (dimension === 'workflow' || dimension === 'trigger') return workflowGroups
  return sql`(${workflowGroups}) UNION ALL (${chatGroups})`
}

/** Each group has at most one workflow average and one exact chat-member count. */
const aggregates = sql`
  sum(a."workflowRuns") AS "workflowRuns",
  sum(a.completed) AS completed,
  sum(a.failed) AS failed,
  sum(a."chatRuns") AS "chatRuns",
  sum(a."chatMembers") AS "chatMembers",
  max(a."averageDurationMs") AS "averageDurationMs"
`

/**
 * A stretch holding an unfinished run is never cached (see `inFlight`), so the lag only
 * has to cover a run that started but whose row has not yet been written. Every
 * minute of lag is a minute of the most expensive rows on the page read live.
 */
const ACTIVITY_SETTLE_MS = 15 * 60 * 1000

/**
 * Only finished runs are cached, and those do not change, so cached activity expires
 * only to release organizations nobody is viewing.
 */
const ACTIVITY_SEGMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000

type ActivityHourRow = Record<string, unknown> & {
  hour: string
  workflowRuns: string | number
  completed: string | number
  failed: string | number
  durationSum: string | number
  durationCount: string | number
  chatRuns: string | number
  chatMembers: string[]
  inFlight: string | number
}

/** Workflow and chat activity per local hour of the viewer (`YYYY-MM-DDTHH`), for one range. */
async function readActivityByHour(
  scope: ActivityScope,
  timezone: string
): Promise<Map<string, ActivityStretch>> {
  assertValidTimezone(timezone)
  const { workflows, chats } = activitySources(scope)
  const hour = sql`date_trunc('hour', (a.started_at AT TIME ZONE 'UTC') AT TIME ZONE ${timezone})`
  /** Members as JSON: the pool skips type fetching, so a `text[]` would arrive unparsed. */
  const rows = await dbReplica.execute<ActivityHourRow>(sql`
    SELECT to_char(g.hour, 'YYYY-MM-DD"T"HH24') AS hour, g."workflowRuns", g.completed, g.failed,
      g."durationSum", g."durationCount", g."chatRuns", g."chatMembers", g."inFlight"
    FROM (
      SELECT ${hour} AS hour, count(*) AS "workflowRuns",
        count(*) FILTER (WHERE a.status = 'completed') AS completed,
        count(*) FILTER (WHERE a.status = 'failed') AS failed,
        coalesce(sum(a.duration_ms), 0) AS "durationSum",
        count(a.duration_ms) AS "durationCount",
        0::bigint AS "chatRuns", '[]'::jsonb AS "chatMembers",
        count(*) FILTER (WHERE a.status NOT IN ('completed', 'failed', 'cancelled')) AS "inFlight"
      FROM (${workflows}) a GROUP BY 1
      UNION ALL
      SELECT ${hour} AS hour, 0, 0, 0, 0, 0, count(*),
        coalesce(jsonb_agg(DISTINCT a.member_id) FILTER (WHERE a.member_id IS NOT NULL), '[]'::jsonb),
        0
      FROM (${chats}) a GROUP BY 1
    ) g
  `)

  /** The workflow and chat halves of an hour arrive as two rows. */
  const byHour = new Map<string, ActivityStretch[]>()
  for (const row of rows) {
    const stretch: ActivityStretch = {
      workflowRuns: Number(row.workflowRuns),
      completed: Number(row.completed),
      failed: Number(row.failed),
      durationSum: Number(row.durationSum),
      durationCount: Number(row.durationCount),
      chatRuns: Number(row.chatRuns),
      chatMembers: row.chatMembers,
      inFlight: Number(row.inFlight),
    }
    const halves = byHour.get(row.hour)
    if (halves) halves.push(stretch)
    else byHour.set(row.hour, [stretch])
  }
  return new Map([...byHour].map(([hour, halves]) => [hour, combineActivity(halves)]))
}

/**
 * Activity across the scope's window as `[day, activity]` entries, settled days and
 * hours from the cache. A day can appear in more than one entry.
 *
 * Execution history is read through the same segment cache as usage: the workflow
 * and chat scans behind a month of a large organization's activity cost seconds, and
 * the recent runs are the costliest rows of all to read.
 */
export function readActivityDays(
  scope: ActivityScope,
  timezone: string
): Promise<[string, ActivityStretch][]> {
  return readThroughSegments<ActivityStretch>({
    namespace: `activity:${scope.organizationId}:${scope.workspaceId ?? '*'}:${timezone}`,
    segments: usageWindowSegments({ kind: 'range', from: scope.start, to: scope.end }, timezone, {
      settleMs: ACTIVITY_SETTLE_MS,
    }),
    empty: EMPTY_ACTIVITY_STRETCH,
    combine: combineActivity,
    isFinal: (activity) => activity.inFlight === 0,
    ttlMs: ACTIVITY_SEGMENT_TTL_MS,
    fetchRange: (start, end) => readActivityByHour({ ...scope, start, end }, timezone),
  })
}

/** Aggregation and pagination happen in Postgres; no run history is materialized in the app. */
export async function readActivityBreakdown(
  scope: ActivityScope,
  dimension: ActivityDimension,
  sort: ActivitySort,
  page: number
) {
  const id = {
    workspace: sql`coalesce(a.workspace_id, 'organization')`,
    workflow: sql`coalesce(a.workflow_id, 'deleted:' || a.workspace_id)`,
    member: sql`a.member_id`,
    trigger: sql`a.trigger`,
  }[dimension]
  const label = {
    workspace: sql`coalesce(w.name, 'Organization chats')`,
    workflow: sql`coalesce(f.name, 'Deleted workflows')`,
    member: sql`coalesce(u.name, 'Deleted member')`,
    trigger: sql`a.id`,
  }[dimension]
  const hasWorkspace = dimension === 'workspace' || dimension === 'workflow'
  const workspaceId = hasWorkspace ? sql`a.workspace_id` : sql`NULL::text`
  const workspaceName = hasWorkspace ? sql`w.name` : sql`NULL::text`
  const order = {
    runs: sql`("workflowRuns" + "chatRuns") DESC`,
    failures: sql`failed DESC`,
    duration: sql`"averageDurationMs" DESC NULLS LAST`,
  }[sort]
  const rows = await dbReplica.execute<
    ActivityAggregate & {
      id: string
      label: string
      workspaceId: string | null
      workspaceName: string | null
    }
  >(sql`
    WITH activity AS (${activityGroups(
      scope,
      sql`${id} AS id, ${workspaceId} AS "workspaceId"`,
      dimension
    )}), grouped AS (
      SELECT a.id, a."workspaceId", ${aggregates}
      FROM activity a
      GROUP BY 1, 2
    ), named AS (
      SELECT a.*, ${label} AS label, ${workspaceName} AS "workspaceName"
      FROM grouped a
      ${hasWorkspace ? sql`LEFT JOIN ${workspace} w ON w.id = a."workspaceId"` : sql``}
      ${dimension === 'workflow' ? sql`LEFT JOIN ${workflow} f ON f.id = a.id` : sql``}
      ${dimension === 'member' ? sql`LEFT JOIN ${user} u ON u.id = a.id` : sql``}
    )
    SELECT * FROM named ORDER BY ${order}, label, id
    LIMIT ${ACTIVITY_PAGE_SIZE + 1} OFFSET ${page * ACTIVITY_PAGE_SIZE}
  `)
  return {
    rows: rows.slice(0, ACTIVITY_PAGE_SIZE).map((row) => ({
      id: row.id,
      label: row.label,
      workspaceId: row.workspaceId,
      workspaceName: row.workspaceName,
      ...activityMetrics(row),
    })),
    hasMore: rows.length > ACTIVITY_PAGE_SIZE,
  }
}
