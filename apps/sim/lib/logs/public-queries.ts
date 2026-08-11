import { db } from '@sim/db'
import {
  pausedExecutions,
  user,
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
} from '@sim/db/schema'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { workflowExecutionOriginSql } from '@/lib/logs/execution-origin'
import { buildLogFilters, getOrderBy, type LogFilters } from '@/lib/logs/public-filters'

export interface PublicLogCursor {
  startedAt: string
  id: string
  order: 'asc' | 'desc'
}

export function encodePublicLogCursor(cursor: PublicLogCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64')
}

export function decodePublicLogCursor(
  cursor: string,
  expectedOrder: 'asc' | 'desc'
): PublicLogCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString()) as Record<string, unknown>
    const order = parsed.order === undefined ? expectedOrder : parsed.order
    if (
      typeof parsed.startedAt !== 'string' ||
      typeof parsed.id !== 'string' ||
      (order !== 'asc' && order !== 'desc') ||
      order !== expectedOrder
    ) {
      return null
    }
    const startedAt = new Date(parsed.startedAt)
    if (Number.isNaN(startedAt.getTime())) return null
    return { startedAt: parsed.startedAt, id: parsed.id, order }
  } catch {
    return null
  }
}

export interface ListPublicWorkflowLogsInput {
  filters: LogFilters
  limit: number
  includeExecutionData: boolean
  folderScope?: {
    includesRoot: boolean
    folderIds: string[]
  }
}

/**
 * Reads the workflow-execution log page shared by the v1 and v2 public
 * adapters. Folder path resolution remains an adapter concern; this query takes
 * the resulting ids and applies one coherent root/non-root predicate.
 */
export async function listPublicWorkflowLogs(input: ListPublicWorkflowLogsInput) {
  const filters = input.folderScope ? { ...input.filters, folderIds: undefined } : input.filters
  const conditions = buildLogFilters(filters)
  const folderCondition = input.folderScope
    ? or(
        input.folderScope.includesRoot ? isNull(workflow.folderId) : undefined,
        input.folderScope.folderIds.length > 0
          ? inArray(workflow.folderId, input.folderScope.folderIds)
          : undefined
      )
    : undefined

  const rows = await db
    .select({
      id: workflowExecutionLogs.id,
      workflowId: workflowExecutionLogs.workflowId,
      workspaceId: workflowExecutionLogs.workspaceId,
      executionId: workflowExecutionLogs.executionId,
      deploymentVersionId: workflowExecutionLogs.deploymentVersionId,
      status: workflowExecutionLogs.status,
      level: workflowExecutionLogs.level,
      trigger: workflowExecutionLogs.trigger,
      startedAt: workflowExecutionLogs.startedAt,
      endedAt: workflowExecutionLogs.endedAt,
      totalDurationMs: workflowExecutionLogs.totalDurationMs,
      costTotal: workflowExecutionLogs.costTotal,
      files: workflowExecutionLogs.files,
      executionData: input.includeExecutionData ? workflowExecutionLogs.executionData : sql`null`,
      workflowName: workflow.name,
      workflowDescription: workflow.description,
      workflowFolderId: workflow.folderId,
      workflowUserId: workflow.userId,
      workflowWorkspaceId: workflow.workspaceId,
      workflowCreatedAt: workflow.createdAt,
      workflowUpdatedAt: workflow.updatedAt,
      workflowArchivedAt: workflow.archivedAt,
    })
    .from(workflowExecutionLogs)
    .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
    .where(and(conditions, folderCondition))
    .orderBy(...getOrderBy(input.filters.order))
    .limit(input.limit + 1)

  const hasMore = rows.length > input.limit
  const data = rows.slice(0, input.limit)
  const last = data.at(-1)
  const nextCursor =
    hasMore && last
      ? encodePublicLogCursor({
          startedAt: last.startedAt.toISOString(),
          id: last.id,
          order: input.filters.order ?? 'desc',
        })
      : null

  return { data, nextCursor }
}

export type PublicWorkflowLogLookup =
  | { column: 'id'; value: string }
  | { column: 'executionId'; value: string }

/**
 * Resolves only the canonical resource scope needed to authorize a public run
 * lookup. Protected log content is loaded separately after authorization.
 */
export async function getPublicWorkflowLogScope(executionId: string) {
  const [scope] = await db
    .select({
      executionId: workflowExecutionLogs.executionId,
      workflowId: workflowExecutionLogs.workflowId,
      workspaceId: workflowExecutionLogs.workspaceId,
    })
    .from(workflowExecutionLogs)
    .where(eq(workflowExecutionLogs.executionId, executionId))
    .limit(1)

  return scope ?? null
}

/**
 * Loads one workflow log and its optional workflow snapshot. The snapshot join
 * is deliberately left-sided: a missing snapshot does not make an otherwise
 * valid execution disappear from the log resource.
 */
export async function getPublicWorkflowLog(lookup: PublicWorkflowLogLookup, workspaceId?: string) {
  const lookupCondition =
    lookup.column === 'id'
      ? eq(workflowExecutionLogs.id, lookup.value)
      : eq(workflowExecutionLogs.executionId, lookup.value)

  const rows = await db
    .select({
      id: workflowExecutionLogs.id,
      workflowId: workflowExecutionLogs.workflowId,
      workspaceId: workflowExecutionLogs.workspaceId,
      executionId: workflowExecutionLogs.executionId,
      stateSnapshotId: workflowExecutionLogs.stateSnapshotId,
      deploymentVersionId: workflowExecutionLogs.deploymentVersionId,
      status: workflowExecutionLogs.status,
      level: workflowExecutionLogs.level,
      trigger: workflowExecutionLogs.trigger,
      startedAt: workflowExecutionLogs.startedAt,
      endedAt: workflowExecutionLogs.endedAt,
      totalDurationMs: workflowExecutionLogs.totalDurationMs,
      executionData: workflowExecutionLogs.executionData,
      costTotal: workflowExecutionLogs.costTotal,
      files: workflowExecutionLogs.files,
      createdAt: workflowExecutionLogs.createdAt,
      workflowState: workflowExecutionSnapshots.stateData,
      workflowName: workflow.name,
      workflowDescription: workflow.description,
      workflowFolderId: workflow.folderId,
      workflowUserId: workflow.userId,
      workflowOwnerEmail: user.email,
      workflowWorkspaceId: workflow.workspaceId,
      workflowCreatedAt: workflow.createdAt,
      workflowUpdatedAt: workflow.updatedAt,
      workflowArchivedAt: workflow.archivedAt,
      deploymentVersion: workflowDeploymentVersion.version,
      deploymentVersionName: workflowDeploymentVersion.name,
      pausedStatus: pausedExecutions.status,
      pausedTotalPauseCount: pausedExecutions.totalPauseCount,
      pausedResumedCount: pausedExecutions.resumedCount,
      executionOrigin: workflowExecutionOriginSql().as('execution_origin'),
    })
    .from(workflowExecutionLogs)
    .leftJoin(
      workflowExecutionSnapshots,
      eq(workflowExecutionLogs.stateSnapshotId, workflowExecutionSnapshots.id)
    )
    .leftJoin(
      workflowDeploymentVersion,
      eq(workflowDeploymentVersion.id, workflowExecutionLogs.deploymentVersionId)
    )
    .leftJoin(pausedExecutions, eq(pausedExecutions.executionId, workflowExecutionLogs.executionId))
    .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
    .leftJoin(user, eq(workflow.userId, user.id))
    .where(
      and(
        lookupCondition,
        workspaceId ? eq(workflowExecutionLogs.workspaceId, workspaceId) : undefined
      )
    )
    .limit(1)

  return rows[0] ?? null
}
