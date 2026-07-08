import { dbReplica } from '@sim/db'
import {
  jobExecutionLogs,
  pausedExecutions,
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
} from '@sim/db/schema'
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
  sql,
} from 'drizzle-orm'
import type { z } from 'zod'
import type {
  ListLogsResponse,
  listLogsQuerySchema,
  WorkflowLogSummary,
} from '@/lib/api/contracts/logs'
import { jobCostTotal } from '@/lib/logs/fetch-log-detail'
import { buildFilterConditions } from '@/lib/logs/filters'
import { expandFolderIdsWithDescendants } from '@/lib/logs/folder-expansion'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

export type ListLogsParams = z.output<typeof listLogsQuerySchema>

type SortBy = 'date' | 'duration' | 'cost' | 'status'
type SortOrder = 'asc' | 'desc'

interface CursorData {
  v: string | number | null
  id: string
}

function encodeCursor(data: CursorData): string {
  return Buffer.from(JSON.stringify(data)).toString('base64')
}

export function decodeCursor(cursor: string): CursorData | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString())
    if (typeof parsed?.id !== 'string') return null
    return parsed as CursorData
  } catch {
    return null
  }
}

/**
 * Shared logs list query used by the `/api/logs` route and the copilot `query_logs`
 * tool. Builds the workflow + job execution-log query (cursor pagination, sort,
 * level running/pending logic, job-log merge) from the shared filter params. The
 * caller is responsible for authenticating `userId`; this function enforces
 * workspace permission via the `permissions` join.
 */
export async function listLogs(params: ListLogsParams, userId: string): Promise<ListLogsResponse> {
  const access = await checkWorkspaceAccess(params.workspaceId, userId)
  if (!access.hasAccess) {
    return { data: [], nextCursor: null }
  }

  const sortBy = params.sortBy as SortBy
  const sortOrder = params.sortOrder as SortOrder
  const cursor = params.cursor ? decodeCursor(params.cursor) : null

  // Expand selected folders to include descendants (matches the route behavior),
  // without mutating the caller's params object.
  const folderIds = params.folderIds
    ? await expandFolderIdsWithDescendants(params.workspaceId, params.folderIds)
    : params.folderIds
  const p: ListLogsParams = { ...params, folderIds }

  const workflowSortExpr: SQL<unknown> = (() => {
    switch (sortBy) {
      case 'duration':
        return sql`${workflowExecutionLogs.totalDurationMs}`
      case 'cost':
        // Indexed projection of the usage_log ledger (dollars); no live aggregation.
        return sql`${workflowExecutionLogs.costTotal}`
      case 'status':
        return sql`${workflowExecutionLogs.status}`
      default:
        return sql`${workflowExecutionLogs.startedAt}`
    }
  })()

  const jobSortExpr: SQL<unknown> = (() => {
    switch (sortBy) {
      case 'duration':
        return sql`${jobExecutionLogs.totalDurationMs}`
      case 'cost':
        return sql`(${jobExecutionLogs.cost}->>'total')::numeric`
      case 'status':
        return sql`${jobExecutionLogs.status}`
      default:
        return sql`${jobExecutionLogs.startedAt}`
    }
  })()

  const dir = sortOrder === 'asc' ? asc : desc
  const nullsLast = sql`NULLS LAST`
  const orderByClause = (expr: SQL): SQL => sql`${dir(expr)} ${nullsLast}`

  const buildCursorCondition = (sortExpr: unknown, idCol: unknown): SQL | undefined => {
    if (!cursor) return undefined
    const v = cursor.v
    const id = cursor.id
    const cmp = sortOrder === 'asc' ? sql`>` : sql`<`
    if (v === null) {
      return sql`(${sortExpr} IS NULL AND ${idCol} ${cmp} ${id})`
    }
    return sql`((${sortExpr} IS NOT NULL AND ${sortExpr} ${cmp} ${v}) OR (${sortExpr} = ${v} AND ${idCol} ${cmp} ${id}) OR ${sortExpr} IS NULL)`
  }

  const fetchSize = p.limit + 1

  // Build workflow log conditions
  const workflowConditions: SQL[] = [eq(workflowExecutionLogs.workspaceId, p.workspaceId)]

  if (p.level && p.level !== 'all') {
    const levels = p.level.split(',').filter(Boolean)
    const levelConditions: SQL[] = []

    for (const level of levels) {
      if (level === 'error') {
        levelConditions.push(eq(workflowExecutionLogs.level, 'error'))
      } else if (level === 'info') {
        const c = and(
          eq(workflowExecutionLogs.level, 'info'),
          isNotNull(workflowExecutionLogs.endedAt)
        )
        if (c) levelConditions.push(c)
      } else if (level === 'running') {
        const c = and(
          eq(workflowExecutionLogs.level, 'info'),
          isNull(workflowExecutionLogs.endedAt)
        )
        if (c) levelConditions.push(c)
      } else if (level === 'pending') {
        const c = and(
          eq(workflowExecutionLogs.level, 'info'),
          or(
            sql`(${pausedExecutions.totalPauseCount} > 0 AND ${pausedExecutions.resumedCount} < ${pausedExecutions.totalPauseCount})`,
            and(
              isNotNull(pausedExecutions.status),
              sql`${pausedExecutions.status} != 'fully_resumed'`
            )
          )
        )
        if (c) levelConditions.push(c)
      }
    }

    if (levelConditions.length > 0) {
      workflowConditions.push(
        levelConditions.length === 1 ? levelConditions[0] : or(...levelConditions)!
      )
    }
  }

  const commonFilters = buildFilterConditions(p, { useSimpleLevelFilter: false })
  if (commonFilters) workflowConditions.push(commonFilters)

  const workflowCursorCond = buildCursorCondition(workflowSortExpr, workflowExecutionLogs.id)
  if (workflowCursorCond) workflowConditions.push(workflowCursorCond)

  // Decide whether to include job logs
  const hasWorkflowSpecificFilters = !!(
    p.workflowIds ||
    p.folderIds ||
    p.workflowName ||
    p.folderName
  )
  const triggersList = p.triggers?.split(',').filter(Boolean) || []
  const triggersExcludeJobs =
    triggersList.length > 0 && !triggersList.includes('all') && !triggersList.includes('mothership')
  const levelList = p.level && p.level !== 'all' ? p.level.split(',').filter(Boolean) : []
  const levelExcludesJobs =
    levelList.length > 0 && !levelList.some((l) => l === 'error' || l === 'info')
  const includeJobLogs = !hasWorkflowSpecificFilters && !triggersExcludeJobs && !levelExcludesJobs

  const workflowQuery = dbReplica
    .select({
      id: workflowExecutionLogs.id,
      workflowId: workflowExecutionLogs.workflowId,
      executionId: workflowExecutionLogs.executionId,
      deploymentVersionId: workflowExecutionLogs.deploymentVersionId,
      level: workflowExecutionLogs.level,
      status: workflowExecutionLogs.status,
      trigger: workflowExecutionLogs.trigger,
      startedAt: workflowExecutionLogs.startedAt,
      endedAt: workflowExecutionLogs.endedAt,
      totalDurationMs: workflowExecutionLogs.totalDurationMs,
      costTotal: workflowExecutionLogs.costTotal,
      createdAt: workflowExecutionLogs.createdAt,
      workflowName: workflow.name,
      workflowDescription: workflow.description,
      workflowFolderId: workflow.folderId,
      workflowUserId: workflow.userId,
      workflowWorkspaceId: workflow.workspaceId,
      workflowCreatedAt: workflow.createdAt,
      workflowUpdatedAt: workflow.updatedAt,
      pausedStatus: pausedExecutions.status,
      pausedTotalPauseCount: pausedExecutions.totalPauseCount,
      pausedResumedCount: pausedExecutions.resumedCount,
      deploymentVersion: workflowDeploymentVersion.version,
      deploymentVersionName: workflowDeploymentVersion.name,
      sortValue: sql<unknown>`${workflowSortExpr}`.as('sort_value'),
    })
    .from(workflowExecutionLogs)
    .leftJoin(pausedExecutions, eq(pausedExecutions.executionId, workflowExecutionLogs.executionId))
    .leftJoin(
      workflowDeploymentVersion,
      eq(workflowDeploymentVersion.id, workflowExecutionLogs.deploymentVersionId)
    )
    .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
    .where(and(...workflowConditions))
    .orderBy(orderByClause(workflowSortExpr), dir(workflowExecutionLogs.id))
    .limit(fetchSize)

  const jobConditions: SQL[] = [eq(jobExecutionLogs.workspaceId, p.workspaceId)]

  if (includeJobLogs) {
    if (p.level && p.level !== 'all') {
      const levels = p.level.split(',').filter(Boolean)
      const jobLevelConditions: SQL[] = []
      for (const level of levels) {
        if (level === 'error') {
          jobLevelConditions.push(eq(jobExecutionLogs.level, 'error'))
        } else if (level === 'info') {
          const c = and(eq(jobExecutionLogs.level, 'info'), isNotNull(jobExecutionLogs.endedAt))
          if (c) jobLevelConditions.push(c)
        }
      }
      if (jobLevelConditions.length > 0) {
        jobConditions.push(
          jobLevelConditions.length === 1 ? jobLevelConditions[0] : or(...jobLevelConditions)!
        )
      }
    }

    if (triggersList.length > 0 && !triggersList.includes('all')) {
      jobConditions.push(inArray(jobExecutionLogs.trigger, triggersList))
    }

    if (p.startDate) {
      jobConditions.push(gte(jobExecutionLogs.startedAt, new Date(p.startDate)))
    }
    if (p.endDate) {
      jobConditions.push(lte(jobExecutionLogs.startedAt, new Date(p.endDate)))
    }

    if (p.search) {
      jobConditions.push(sql`${jobExecutionLogs.executionId} ILIKE ${`%${p.search}%`}`)
    }
    if (p.executionId) {
      jobConditions.push(eq(jobExecutionLogs.executionId, p.executionId))
    }

    if (p.costOperator && p.costValue !== undefined) {
      const costField = sql`(${jobExecutionLogs.cost}->>'total')::numeric`
      const ops = {
        '=': sql`=`,
        '>': sql`>`,
        '<': sql`<`,
        '>=': sql`>=`,
        '<=': sql`<=`,
        '!=': sql`!=`,
      } as const
      jobConditions.push(sql`${costField} ${ops[p.costOperator]} ${p.costValue}`)
    }

    if (p.durationOperator && p.durationValue !== undefined) {
      const durationOps: Record<
        string,
        (field: typeof jobExecutionLogs.totalDurationMs, val: number) => SQL | undefined
      > = {
        '=': (f, v) => eq(f, v),
        '>': (f, v) => gt(f, v),
        '<': (f, v) => lt(f, v),
        '>=': (f, v) => gte(f, v),
        '<=': (f, v) => lte(f, v),
        '!=': (f, v) => ne(f, v),
      }
      const durationCond = durationOps[p.durationOperator]?.(
        jobExecutionLogs.totalDurationMs,
        p.durationValue
      )
      if (durationCond) jobConditions.push(durationCond)
    }

    const jobCursorCond = buildCursorCondition(jobSortExpr, jobExecutionLogs.id)
    if (jobCursorCond) jobConditions.push(jobCursorCond)
  }

  const jobQuery = includeJobLogs
    ? dbReplica
        .select({
          id: jobExecutionLogs.id,
          executionId: jobExecutionLogs.executionId,
          level: jobExecutionLogs.level,
          status: jobExecutionLogs.status,
          trigger: jobExecutionLogs.trigger,
          startedAt: jobExecutionLogs.startedAt,
          endedAt: jobExecutionLogs.endedAt,
          totalDurationMs: jobExecutionLogs.totalDurationMs,
          cost: jobExecutionLogs.cost,
          createdAt: jobExecutionLogs.createdAt,
          jobTitle: sql<string | null>`${jobExecutionLogs.executionData}->'trigger'->>'source'`,
          sortValue: sql<unknown>`${jobSortExpr}`.as('sort_value'),
        })
        .from(jobExecutionLogs)
        .where(and(...jobConditions))
        .orderBy(orderByClause(jobSortExpr), dir(jobExecutionLogs.id))
        .limit(fetchSize)
    : Promise.resolve([])

  const [workflowRows, jobRows] = await Promise.all([workflowQuery, jobQuery])

  type RowWithSort = {
    id: string
    sortValue: unknown
    summary: WorkflowLogSummary
  }

  const workflowMapped: RowWithSort[] = workflowRows.map((log) => {
    const totalPauseCount = Number(log.pausedTotalPauseCount ?? 0)
    const resumedCount = Number(log.pausedResumedCount ?? 0)
    const hasPendingPause =
      (totalPauseCount > 0 && resumedCount < totalPauseCount) ||
      (log.pausedStatus !== null && log.pausedStatus !== 'fully_resumed')

    const summary: WorkflowLogSummary = {
      id: log.id,
      workflowId: log.workflowId,
      executionId: log.executionId,
      deploymentVersionId: log.deploymentVersionId,
      deploymentVersion: log.deploymentVersion ?? null,
      deploymentVersionName: log.deploymentVersionName ?? null,
      level: log.level,
      status: log.status,
      duration: log.totalDurationMs ? `${log.totalDurationMs}ms` : null,
      trigger: log.trigger,
      createdAt: log.startedAt.toISOString(),
      workflow: log.workflowId
        ? {
            id: log.workflowId,
            name: log.workflowName,
            description: log.workflowDescription,
            folderId: log.workflowFolderId,
            userId: log.workflowUserId,
            workspaceId: log.workflowWorkspaceId,
            createdAt: log.workflowCreatedAt?.toISOString() ?? null,
            updatedAt: log.workflowUpdatedAt?.toISOString() ?? null,
          }
        : null,
      jobTitle: null,
      // List cost is the cost_total projection (faithful ledger sum). Null until
      // completion (running) or until the one-time legacy backfill populates it.
      cost: log.costTotal != null ? { total: Number(log.costTotal) } : null,
      pauseSummary: {
        status: log.pausedStatus ?? null,
        total: totalPauseCount,
        resumed: resumedCount,
      },
      hasPendingPause,
    }
    return { id: log.id, sortValue: log.sortValue, summary }
  })

  const jobMapped: RowWithSort[] = (jobRows as Awaited<typeof jobQuery>).map((log) => {
    const summary: WorkflowLogSummary = {
      id: log.id,
      workflowId: null,
      executionId: log.executionId,
      deploymentVersionId: null,
      deploymentVersion: null,
      deploymentVersionName: null,
      level: log.level,
      status: log.status,
      duration: log.totalDurationMs ? `${log.totalDurationMs}ms` : null,
      trigger: log.trigger,
      createdAt: log.startedAt.toISOString(),
      workflow: null,
      jobTitle: log.jobTitle ?? null,
      cost: jobCostTotal(log.cost),
      pauseSummary: { status: null, total: 0, resumed: 0 },
      hasPendingPause: false,
    }
    return { id: log.id, sortValue: log.sortValue, summary }
  })

  const compareSortValues = (a: unknown, b: unknown): number => {
    if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime()
    if (typeof a === 'number' && typeof b === 'number') return a - b
    const aStr = String(a)
    const bStr = String(b)
    if (sortBy === 'date') {
      return new Date(aStr).getTime() - new Date(bStr).getTime()
    }
    const aNum = Number(aStr)
    const bNum = Number(bStr)
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) return aNum - bNum
    return aStr.localeCompare(bStr)
  }

  const merged = [...workflowMapped, ...jobMapped].sort((a, b) => {
    const aNull = a.sortValue === null || a.sortValue === undefined
    const bNull = b.sortValue === null || b.sortValue === undefined
    // Mirror SQL's NULLS LAST for both ASC and DESC so the cursor stays consistent.
    if (aNull && !bNull) return 1
    if (!aNull && bNull) return -1
    if (!aNull && !bNull) {
      const cmp = compareSortValues(a.sortValue, b.sortValue)
      if (cmp !== 0) return sortOrder === 'asc' ? cmp : -cmp
    }
    const idCmp = a.id.localeCompare(b.id)
    return sortOrder === 'asc' ? idCmp : -idCmp
  })

  const page = merged.slice(0, p.limit)
  const hasMore = merged.length > p.limit
  let nextCursor: string | null = null
  if (hasMore && page.length > 0) {
    const last = page[page.length - 1]
    const v = last.sortValue
    const cursorV =
      v instanceof Date
        ? v.toISOString()
        : typeof v === 'number' || typeof v === 'string'
          ? v
          : v == null
            ? null
            : String(v)
    nextCursor = encodeCursor({ v: cursorV, id: last.id })
  }

  return {
    data: page.map((row) => row.summary),
    nextCursor,
  }
}
