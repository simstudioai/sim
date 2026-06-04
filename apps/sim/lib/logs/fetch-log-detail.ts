import { db } from '@sim/db'
import {
  jobExecutionLogs,
  pausedExecutions,
  permissions,
  usageLog,
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
} from '@sim/db/schema'
import { and, eq, type SQL } from 'drizzle-orm'
import type { CostLedger } from '@/lib/api/contracts/logs'
import { materializeExecutionData } from '@/lib/logs/execution/trace-store'

type LookupColumn = 'id' | 'executionId'

async function buildCostLedger(executionId: string): Promise<CostLedger | null> {
  const rows = await db
    .select({
      category: usageLog.category,
      description: usageLog.description,
      cost: usageLog.cost,
      metadata: usageLog.metadata,
    })
    .from(usageLog)
    .where(and(eq(usageLog.executionId, executionId), eq(usageLog.source, 'workflow')))

  if (rows.length === 0) return null

  type LedgerItem = CostLedger['items'][number]
  const byKey = new Map<string, LedgerItem>()
  for (const row of rows) {
    const metadata = (row.metadata ?? {}) as { inputTokens?: number; outputTokens?: number }
    const category = row.category as LedgerItem['category']
    const key = `${category}::${row.description}`
    const existing = byKey.get(key)
    if (existing) {
      existing.cost += Number(row.cost)
      if (typeof metadata.inputTokens === 'number') {
        existing.inputTokens = Math.max(existing.inputTokens ?? 0, metadata.inputTokens)
      }
      if (typeof metadata.outputTokens === 'number') {
        existing.outputTokens = Math.max(existing.outputTokens ?? 0, metadata.outputTokens)
      }
    } else {
      byKey.set(key, {
        category,
        description: row.description,
        cost: Number(row.cost),
        ...(typeof metadata.inputTokens === 'number' ? { inputTokens: metadata.inputTokens } : {}),
        ...(typeof metadata.outputTokens === 'number'
          ? { outputTokens: metadata.outputTokens }
          : {}),
      })
    }
  }

  const items = [...byKey.values()]
  const total = items.reduce((sum, item) => sum + item.cost, 0)
  return { total, items }
}

export function jobCostTotal(raw: unknown): { total: number } | null {
  const total = (raw as { total?: unknown } | null | undefined)?.total
  const n = total == null ? Number.NaN : Number(total)
  return Number.isFinite(n) ? { total: n } : null
}

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
      costTotal: workflowExecutionLogs.costTotal,
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

    // Cost is sourced exclusively from the usage_log ledger (itemized breakdown)
    // and its cost_total projection (run total). The cost jsonb is never read.
    const costLedger = await buildCostLedger(log.executionId)
    const totalDollars = costLedger?.total ?? (log.costTotal != null ? Number(log.costTotal) : null)

    // Trace spans / heavy execution data may live in object storage; resolve the
    // pointer here (no-op for inline / pre-externalization rows).
    const executionData = await materializeExecutionData(
      log.executionData as Record<string, unknown> | null,
      { workspaceId, workflowId: log.workflowId, executionId: log.executionId }
    )

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
      cost: totalDollars != null ? { total: totalDollars } : null,
      costLedger,
      pauseSummary: {
        status: log.pausedStatus ?? null,
        total: totalPauseCount,
        resumed: resumedCount,
      },
      hasPendingPause,
      executionData: {
        totalDuration: log.totalDurationMs,
        ...executionData,
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
    cost: jobCostTotal(jobLog.cost),
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
