import { db } from '@sim/db'
import {
  jobExecutionLogs,
  pausedExecutions,
  permissions,
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
} from '@sim/db/schema'
import { and, eq, type SQL } from 'drizzle-orm'

type LookupColumn = 'id' | 'executionId'

interface FetchLogDetailArgs {
  userId: string
  workspaceId: string
  lookupColumn: LookupColumn
  lookupValue: string
}

/**
 * Shared loader for the workflow-log detail shape returned by the by-id and
 * by-execution routes. Returns `null` when no matching row exists in either
 * the workflow-execution or job-execution tables for this user + workspace.
 */
export async function fetchLogDetail({
  userId,
  workspaceId,
  lookupColumn,
  lookupValue,
}: FetchLogDetailArgs) {
  const workflowMatch: SQL =
    lookupColumn === 'id'
      ? eq(workflowExecutionLogs.id, lookupValue)
      : eq(workflowExecutionLogs.executionId, lookupValue)

  const rows = await db
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
      executionData: workflowExecutionLogs.executionData,
      cost: workflowExecutionLogs.cost,
      files: workflowExecutionLogs.files,
      createdAt: workflowExecutionLogs.createdAt,
      workflowName: workflow.name,
      workflowDescription: workflow.description,
      workflowColor: workflow.color,
      workflowFolderId: workflow.folderId,
      workflowUserId: workflow.userId,
      workflowWorkspaceId: workflow.workspaceId,
      workflowCreatedAt: workflow.createdAt,
      workflowUpdatedAt: workflow.updatedAt,
      deploymentVersion: workflowDeploymentVersion.version,
      deploymentVersionName: workflowDeploymentVersion.name,
      pausedStatus: pausedExecutions.status,
      pausedTotalPauseCount: pausedExecutions.totalPauseCount,
      pausedResumedCount: pausedExecutions.resumedCount,
    })
    .from(workflowExecutionLogs)
    .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
    .leftJoin(
      workflowDeploymentVersion,
      eq(workflowDeploymentVersion.id, workflowExecutionLogs.deploymentVersionId)
    )
    .leftJoin(pausedExecutions, eq(pausedExecutions.executionId, workflowExecutionLogs.executionId))
    .innerJoin(
      permissions,
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, workflowExecutionLogs.workspaceId),
        eq(permissions.userId, userId)
      )
    )
    .where(and(workflowMatch, eq(workflowExecutionLogs.workspaceId, workspaceId)))
    .limit(1)

  const log = rows[0]

  if (log) {
    const workflowSummary = log.workflowId
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
      : null

    const totalPauseCount = Number(log.pausedTotalPauseCount ?? 0)
    const resumedCount = Number(log.pausedResumedCount ?? 0)
    const hasPendingPause =
      (totalPauseCount > 0 && resumedCount < totalPauseCount) ||
      (log.pausedStatus !== null && log.pausedStatus !== 'fully_resumed')

    return {
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
      workflow: workflowSummary,
      jobTitle: null,
      cost: log.cost ?? null,
      pauseSummary: {
        status: log.pausedStatus ?? null,
        total: totalPauseCount,
        resumed: resumedCount,
      },
      hasPendingPause,
      executionData: {
        totalDuration: log.totalDurationMs,
        ...((log.executionData as Record<string, unknown> | null) ?? {}),
        enhanced: true as const,
      },
      files: log.files ?? null,
    }
  }

  const jobMatch: SQL =
    lookupColumn === 'id'
      ? eq(jobExecutionLogs.id, lookupValue)
      : eq(jobExecutionLogs.executionId, lookupValue)

  const jobRows = await db
    .select({
      id: jobExecutionLogs.id,
      executionId: jobExecutionLogs.executionId,
      level: jobExecutionLogs.level,
      status: jobExecutionLogs.status,
      trigger: jobExecutionLogs.trigger,
      startedAt: jobExecutionLogs.startedAt,
      endedAt: jobExecutionLogs.endedAt,
      totalDurationMs: jobExecutionLogs.totalDurationMs,
      executionData: jobExecutionLogs.executionData,
      cost: jobExecutionLogs.cost,
      createdAt: jobExecutionLogs.createdAt,
    })
    .from(jobExecutionLogs)
    .innerJoin(
      permissions,
      and(
        eq(permissions.entityType, 'workspace'),
        eq(permissions.entityId, jobExecutionLogs.workspaceId),
        eq(permissions.userId, userId)
      )
    )
    .where(and(jobMatch, eq(jobExecutionLogs.workspaceId, workspaceId)))
    .limit(1)

  const jobLog = jobRows[0]
  if (!jobLog) return null

  const execData = (jobLog.executionData as Record<string, unknown> | null) ?? {}
  return {
    id: jobLog.id,
    workflowId: null,
    executionId: jobLog.executionId,
    deploymentVersionId: null,
    deploymentVersion: null,
    deploymentVersionName: null,
    level: jobLog.level,
    status: jobLog.status,
    duration: jobLog.totalDurationMs ? `${jobLog.totalDurationMs}ms` : null,
    trigger: jobLog.trigger,
    createdAt: jobLog.startedAt.toISOString(),
    workflow: null,
    jobTitle: ((execData.trigger as Record<string, unknown> | undefined)?.source as string) ?? null,
    cost: jobLog.cost ?? null,
    pauseSummary: { status: null, total: 0, resumed: 0 },
    hasPendingPause: false,
    executionData: {
      totalDuration: jobLog.totalDurationMs,
      ...execData,
      enhanced: true as const,
    },
    files: null,
  }
}
