import { dbReplica } from '@sim/db'
import { workflow, workflowExecutionLogs } from '@sim/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import { assertValidTimezone } from '@/lib/core/utils/timezone'
import { buildFilterConditions } from '@/lib/logs/filters'
import { expandFolderIdsWithDescendants } from '@/lib/logs/folder-expansion'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

/**
 * Server-side aggregation over workflow execution logs for the copilot
 * `query_logs` stats view: per-workflow, optionally calendar-bucketed counts by
 * status, under the same filter set as the list view. Exists so a model never
 * has to paginate the list and count client-side. Job (Sim-agent) executions
 * are not included — same scope as the Logs dashboard stats.
 */

export interface StatsLogsParams {
  workspaceId: string
  level?: string
  workflowIds?: string
  folderIds?: string
  triggers?: string
  startDate?: string
  endDate?: string
  search?: string
  workflowName?: string
  folderName?: string
  /** Calendar bucketing for the per-workflow series; omit for totals only. */
  bucket?: 'day' | 'hour'
  /** IANA timezone the buckets are computed in. Defaults to UTC. */
  timezone?: string
}

export interface LogStatsBucket {
  /** Bucket start in the requested timezone (naive local timestamp). */
  start: string
  executions: number
  byStatus: Record<string, number>
  avgDurationMs: number
}

export interface WorkflowLogStats {
  workflowId: string
  workflowName: string
  executions: number
  byStatus: Record<string, number>
  avgDurationMs: number
  buckets?: LogStatsBucket[]
}

export interface LogStatsResponse {
  bucket: 'day' | 'hour' | null
  timezone: string
  totals: { executions: number; byStatus: Record<string, number>; avgDurationMs: number }
  workflows: WorkflowLogStats[]
  /** Set when more workflows matched than are returned (ordered by executions). */
  workflowsTruncated?: boolean
}

const MAX_WORKFLOWS = 100

interface StatsAccumulator {
  executions: number
  byStatus: Record<string, number>
  durationSumMs: number
  durationCount: number
}

function newAccumulator(): StatsAccumulator {
  return { executions: 0, byStatus: {}, durationSumMs: 0, durationCount: 0 }
}

function accumulate(acc: StatsAccumulator, status: string, row: RawStatsRow): void {
  acc.executions += Number(row.executions)
  acc.byStatus[status] = (acc.byStatus[status] ?? 0) + Number(row.executions)
  acc.durationSumMs += Number(row.durationSumMs)
  acc.durationCount += Number(row.durationCount)
}

function avgOf(acc: StatsAccumulator): number {
  return acc.durationCount > 0 ? Math.round(acc.durationSumMs / acc.durationCount) : 0
}

interface RawStatsRow {
  workflowId: string
  workflowName: string
  bucketStart: string | null
  status: string | null
  executions: number
  durationSumMs: number
  durationCount: number
}

export async function statsLogs(
  params: StatsLogsParams,
  userId: string
): Promise<LogStatsResponse> {
  const timezone = params.timezone ?? 'UTC'
  assertValidTimezone(timezone)
  const bucket = params.bucket ?? null

  const access = await checkWorkspaceAccess(params.workspaceId, userId)
  if (!access.hasAccess) {
    return {
      bucket,
      timezone,
      totals: { executions: 0, byStatus: {}, avgDurationMs: 0 },
      workflows: [],
    }
  }

  const folderIds = params.folderIds
    ? await expandFolderIdsWithDescendants(params.workspaceId, params.folderIds)
    : params.folderIds
  const p = { ...params, folderIds }

  const workspaceFilter = eq(workflowExecutionLogs.workspaceId, p.workspaceId)
  const commonFilters = buildFilterConditions(p, { useSimpleLevelFilter: true })
  const whereCondition = commonFilters ? and(workspaceFilter, commonFilters) : workspaceFilter

  const bucketExpr = bucket
    ? sql<
        string | null
      >`to_char(date_trunc(${bucket}, ${workflowExecutionLogs.startedAt} AT TIME ZONE ${timezone}), 'YYYY-MM-DD"T"HH24:MI:SS')`
    : sql<string | null>`NULL`

  const rows = (await dbReplica
    .select({
      workflowId: sql<string>`COALESCE(${workflowExecutionLogs.workflowId}, 'deleted')`,
      workflowName: sql<string>`COALESCE(${workflow.name}, 'Deleted Workflow')`,
      bucketStart: bucketExpr.as('bucket_start'),
      status: workflowExecutionLogs.status,
      executions: sql<number>`COUNT(*)`,
      durationSumMs: sql<number>`COALESCE(SUM(${workflowExecutionLogs.totalDurationMs}) FILTER (WHERE ${workflowExecutionLogs.totalDurationMs} > 0), 0)`,
      durationCount: sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionLogs.totalDurationMs} > 0)`,
    })
    .from(workflowExecutionLogs)
    .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
    .where(whereCondition)
    .groupBy(
      sql`COALESCE(${workflowExecutionLogs.workflowId}, 'deleted')`,
      sql`COALESCE(${workflow.name}, 'Deleted Workflow')`,
      sql`bucket_start`,
      workflowExecutionLogs.status
    )) as RawStatsRow[]

  const totals = newAccumulator()
  const byWorkflow = new Map<
    string,
    { workflowName: string; overall: StatsAccumulator; buckets: Map<string, StatsAccumulator> }
  >()

  for (const row of rows) {
    const status = row.status ?? 'unknown'
    accumulate(totals, status, row)
    let wf = byWorkflow.get(row.workflowId)
    if (!wf) {
      wf = { workflowName: row.workflowName, overall: newAccumulator(), buckets: new Map() }
      byWorkflow.set(row.workflowId, wf)
    }
    accumulate(wf.overall, status, row)
    if (bucket && row.bucketStart) {
      let bucketAcc = wf.buckets.get(row.bucketStart)
      if (!bucketAcc) {
        bucketAcc = newAccumulator()
        wf.buckets.set(row.bucketStart, bucketAcc)
      }
      accumulate(bucketAcc, status, row)
    }
  }

  const workflows: WorkflowLogStats[] = Array.from(byWorkflow.entries())
    .map(([workflowId, wf]) => ({
      workflowId,
      workflowName: wf.workflowName,
      executions: wf.overall.executions,
      byStatus: wf.overall.byStatus,
      avgDurationMs: avgOf(wf.overall),
      ...(bucket
        ? {
            buckets: Array.from(wf.buckets.entries())
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([start, acc]) => ({
                start,
                executions: acc.executions,
                byStatus: acc.byStatus,
                avgDurationMs: avgOf(acc),
              })),
          }
        : {}),
    }))
    .sort((a, b) => b.executions - a.executions)

  const truncated = workflows.length > MAX_WORKFLOWS

  return {
    bucket,
    timezone,
    totals: {
      executions: totals.executions,
      byStatus: totals.byStatus,
      avgDurationMs: avgOf(totals),
    },
    workflows: truncated ? workflows.slice(0, MAX_WORKFLOWS) : workflows,
    ...(truncated ? { workflowsTruncated: true } : {}),
  }
}
