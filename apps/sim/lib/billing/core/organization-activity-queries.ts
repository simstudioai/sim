import { dbReplica } from '@sim/db'
import {
  copilotChats,
  copilotRuns,
  user,
  workflow,
  workflowExecutionLogs,
  workspace,
} from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import {
  ACTIVITY_PAGE_SIZE,
  type ActivityAggregate,
  type ActivityDimension,
  type ActivityScope,
  type ActivitySort,
  activityMetrics,
} from '@/lib/billing/core/organization-activity'
import type { UsageBucket } from '@/lib/billing/core/usage-analytics'

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
function activityCte(scope: ActivityScope, dimension?: ActivityDimension) {
  const start = sql`(${scope.start.toISOString()}::timestamptz AT TIME ZONE 'UTC')`
  const end = sql`(${scope.end.toISOString()}::timestamptz AT TIME ZONE 'UTC')`
  const workflows = sql`
    SELECT 'workflow' AS kind, l.workspace_id, l.workflow_id, NULL::text AS member_id,
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
      'chat' AS kind, c.workspace_id, NULL::text AS workflow_id, r.user_id AS member_id,
      NULL::text AS trigger, r.started_at, NULL::text AS status, NULL::integer AS duration_ms
    FROM ${copilotRuns} r
    JOIN (${scopedChats}) c ON c.id = r.chat_id
    WHERE r.started_at >= ${start} AND r.started_at < ${end}
      AND NOT EXISTS (
        SELECT 1 FROM ${copilotRuns} earlier
        WHERE earlier.execution_id = r.execution_id AND earlier.started_at < ${start}
      )
    ORDER BY r.execution_id, r.started_at, r.id
  `
  const source =
    dimension === 'member'
      ? chats
      : dimension === 'workflow' || dimension === 'trigger'
        ? workflows
        : sql`(${workflows}) UNION ALL (${chats})`
  return sql`WITH activity AS (${source})`
}

const aggregates = sql`
  count(*) FILTER (WHERE a.kind = 'workflow') AS "workflowRuns",
  count(*) FILTER (WHERE a.kind = 'workflow' AND a.status = 'completed') AS completed,
  count(*) FILTER (WHERE a.kind = 'workflow' AND a.status = 'failed') AS failed,
  count(*) FILTER (WHERE a.kind = 'chat') AS "chatRuns",
  count(DISTINCT a.member_id) AS "chatMembers",
  avg(a.duration_ms) AS "averageDurationMs"
`

export async function readActivitySummary(
  scope: ActivityScope,
  bucket: UsageBucket,
  timezone: string
) {
  const rows = await dbReplica.execute<ActivityAggregate & { bucket: string | null }>(sql`
    ${activityCte(scope)}
    SELECT to_char(date_trunc(${bucket}, (started_at AT TIME ZONE 'UTC') AT TIME ZONE ${timezone}),
      'YYYY-MM-DD') AS bucket, ${aggregates}
    FROM activity a GROUP BY GROUPING SETS ((1), ())
  `)
  return {
    totals: activityMetrics(rows.find((row) => row.bucket === null)),
    series: rows.flatMap((row) =>
      row.bucket === null
        ? []
        : [
            {
              timestamp: `${row.bucket}T00:00:00`,
              workflowRuns: Number(row.workflowRuns),
              chatRuns: Number(row.chatRuns),
              failed: Number(row.failed),
            },
          ]
    ),
  }
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
    ${activityCte(scope, dimension)}, grouped AS (
      SELECT ${id} AS id, ${workspaceId} AS "workspaceId", ${aggregates}
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
