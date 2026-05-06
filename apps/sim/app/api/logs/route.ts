import { db } from '@sim/db'
import {
  jobExecutionLogs,
  pausedExecutions,
  permissions,
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
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
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { listLogsContract, type WorkflowLogSummary } from '@/lib/api/contracts/logs'
import { parseRequest } from '@/lib/api/server'
import { checkSessionOrInternalAuth } from '@/lib/auth/hybrid'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { buildFilterConditions } from '@/lib/logs/filters'

const logger = createLogger('LogsAPI')

type SortBy = 'date' | 'duration' | 'cost' | 'status'
type SortOrder = 'asc' | 'desc'

interface CursorData {
  v: string | number | null
  id: string
}

function encodeCursor(data: CursorData): string {
  return Buffer.from(JSON.stringify(data)).toString('base64')
}

function decodeCursor(cursor: string): CursorData | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString())
    if (typeof parsed?.id !== 'string') return null
    return parsed as CursorData
  } catch {
    return null
  }
}

export const GET = withRouteHandler(async (request: NextRequest) => {
  const authResult = await checkSessionOrInternalAuth(request, { requireWorkflowId: false })
  if (!authResult.success || !authResult.userId) {
    return NextResponse.json(
      { error: authResult.error || 'Authentication required' },
      { status: 401 }
    )
  }
  const userId = authResult.userId

  const parsed = await parseRequest(listLogsContract, request, {})
  if (!parsed.success) return parsed.response

  const params = parsed.data.query
  const sortBy = params.sortBy as SortBy
  const sortOrder = params.sortOrder as SortOrder
  const cursor = params.cursor ? decodeCursor(params.cursor) : null

  const workflowSortExpr: SQL<unknown> = (() => {
    switch (sortBy) {
      case 'duration':
        return sql`${workflowExecutionLogs.totalDurationMs}`
      case 'cost':
        return sql`(${workflowExecutionLogs.cost}->>'total')::numeric`
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

  const fetchSize = params.limit + 1

  // Build workflow log conditions
  const workflowConditions: SQL[] = [eq(workflowExecutionLogs.workspaceId, params.workspaceId)]

  if (params.level && params.level !== 'all') {
    const levels = params.level.split(',').filter(Boolean)
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

  const commonFilters = buildFilterConditions(params, { useSimpleLevelFilter: false })
  if (commonFilters) workflowConditions.push(commonFilters)

  const workflowCursorCond = buildCursorCondition(workflowSortExpr, workflowExecutionLogs.id)
  if (workflowCursorCond) workflowConditions.push(workflowCursorCond)

  // Decide whether to include job logs
  const hasWorkflowSpecificFilters = !!(
    params.workflowIds ||
    params.folderIds ||
    params.workflowName ||
    params.folderName
  )
  const triggersList = params.triggers?.split(',').filter(Boolean) || []
  const triggersExcludeJobs =
    triggersList.length > 0 && !triggersList.includes('all') && !triggersList.includes('mothership')
  const levelList =
    params.level && params.level !== 'all' ? params.level.split(',').filter(Boolean) : []
  const levelExcludesJobs =
    levelList.length > 0 && !levelList.some((l) => l === 'error' || l === 'info')
  const includeJobLogs = !hasWorkflowSpecificFilters && !triggersExcludeJobs && !levelExcludesJobs

  const workflowQuery = db
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
      cost: workflowExecutionLogs.cost,
      createdAt: workflowExecutionLogs.createdAt,
      workflowName: workflow.name,
      workflowDescription: workflow.description,
      workflowColor: workflow.color,
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
    .innerJoin(
      permissions,
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workflowExecutionLogs.workspaceId),
        eq(permissions.userId, userId)
      )
    )
    .where(and(...workflowConditions))
    .orderBy(orderByClause(workflowSortExpr), dir(workflowExecutionLogs.id))
    .limit(fetchSize)

  const jobConditions: SQL[] = [eq(jobExecutionLogs.workspaceId, params.workspaceId)]

  if (includeJobLogs) {
    jobConditions.push(
      sql`EXISTS (SELECT 1 FROM ${permissions} WHERE ${permissions.entityType} = 'workspace' AND ${permissions.entityId} = ${jobExecutionLogs.workspaceId} AND ${permissions.userId} = ${userId})`
    )

    if (params.level && params.level !== 'all') {
      const levels = params.level.split(',').filter(Boolean)
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

    if (params.startDate) {
      jobConditions.push(gte(jobExecutionLogs.startedAt, new Date(params.startDate)))
    }
    if (params.endDate) {
      jobConditions.push(lte(jobExecutionLogs.startedAt, new Date(params.endDate)))
    }

    if (params.search) {
      jobConditions.push(sql`${jobExecutionLogs.executionId} ILIKE ${`%${params.search}%`}`)
    }
    if (params.executionId) {
      jobConditions.push(eq(jobExecutionLogs.executionId, params.executionId))
    }

    if (params.costOperator && params.costValue !== undefined) {
      const costField = sql`(${jobExecutionLogs.cost}->>'total')::numeric`
      const ops = {
        '=': sql`=`,
        '>': sql`>`,
        '<': sql`<`,
        '>=': sql`>=`,
        '<=': sql`<=`,
        '!=': sql`!=`,
      } as const
      jobConditions.push(sql`${costField} ${ops[params.costOperator]} ${params.costValue}`)
    }

    if (params.durationOperator && params.durationValue !== undefined) {
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
      const durationCond = durationOps[params.durationOperator]?.(
        jobExecutionLogs.totalDurationMs,
        params.durationValue
      )
      if (durationCond) jobConditions.push(durationCond)
    }

    const jobCursorCond = buildCursorCondition(jobSortExpr, jobExecutionLogs.id)
    if (jobCursorCond) jobConditions.push(jobCursorCond)
  }

  const jobQuery = includeJobLogs
    ? db
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
            color: log.workflowColor,
            folderId: log.workflowFolderId,
            userId: log.workflowUserId,
            workspaceId: log.workflowWorkspaceId,
            createdAt: log.workflowCreatedAt?.toISOString() ?? null,
            updatedAt: log.workflowUpdatedAt?.toISOString() ?? null,
          }
        : null,
      jobTitle: null,
      cost: (log.cost as WorkflowLogSummary['cost']) ?? null,
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
      cost: (log.cost as WorkflowLogSummary['cost']) ?? null,
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

  const page = merged.slice(0, params.limit)
  const hasMore = merged.length > params.limit
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

  logger.debug('Listed logs', {
    workspaceId: params.workspaceId,
    count: page.length,
    hasMore,
    sortBy,
    sortOrder,
  })

  return NextResponse.json({
    data: page.map((row) => row.summary),
    nextCursor,
  })
})
