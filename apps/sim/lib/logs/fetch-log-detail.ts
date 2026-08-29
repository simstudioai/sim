import { db } from '@sim/db'
import {
  jobExecutionLogs,
  pausedExecutions,
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
} from '@sim/db/schema'
import { and, eq, type SQL } from 'drizzle-orm'
import { type WorkflowLogDetail, workflowLogDetailSchema } from '@/lib/api/contracts/logs'
import { buildCostLedger } from '@/lib/logs/cost-ledger'
import { hydrateChildTraces } from '@/lib/logs/execution/hydrate-child-traces'
import {
  type ExecutionProgressMarkers,
  getProgressMarkers,
  pickLatestCompletedMarker,
  pickLatestStartedMarker,
} from '@/lib/logs/execution/progress-markers'
import { materializeExecutionDataForDisplay } from '@/lib/logs/execution/trace-store'
import { workflowExecutionOriginSql } from '@/lib/logs/execution-origin'
import type { TraceSpan } from '@/lib/logs/types'

type LookupColumn = 'id' | 'executionId'

export function jobCostTotal(raw: unknown): { total: number } | null {
  const total = (raw as { total?: unknown } | null | undefined)?.total
  const n = total == null ? Number.NaN : Number(total)
  return Number.isFinite(n) ? { total: n } : null
}

interface FetchLogDetailArgs {
  /**
   * The user reading the log, when there is one. Attribution only — workspace
   * authorization already happened upstream, and the display path never writes.
   * An actorless run (a schedule, or a webhook with no external subject) has no
   * user to name and passes none.
   */
  viewerUserId?: string
  workspaceId: string
  lookupColumn: LookupColumn
  lookupValue: string
  signal?: AbortSignal
  /**
   * Whether the viewer's permission group withholds execution detail. Applied
   * here rather than in the client, because the payloads it covers — trace
   * spans, block inputs and outputs, the final output — are the customer data
   * the restriction exists to withhold, and a hidden tab withholds nothing from
   * a caller reading the route directly.
   */
  hideTraceSpans?: boolean
  /**
   * Whether the viewer's permission group withholds spend. Applied here for the
   * same reason as {@link FetchLogDetailArgs.hideTraceSpans}: the run total, the
   * itemized ledger and the per-block and per-span costs are the figures the
   * restriction exists to withhold, and a hidden column withholds nothing from a
   * caller reading the route directly.
   */
  hideCostInfo?: boolean
}

/**
 * Strips the execution payloads a permission group withholds.
 *
 * Deletes rather than relies on the schema: `executionDataDetailSchema` is a
 * passthrough, so a field left in place would survive response validation.
 * Applied before child traces are hydrated, so a withheld view does not pay for
 * a cross-workspace join whose result it discards.
 */
function withheldExecutionData(executionData: Record<string, unknown>): Record<string, unknown> {
  const {
    traceSpans: _traceSpans,
    blockExecutions: _blockExecutions,
    finalOutput: _finalOutput,
    workflowInput: _workflowInput,
    blockInput: _blockInput,
    ...retained
  } = executionData
  return retained
}

/** A span or block execution with the spend fields stripped from it. */
function withoutSpend(entry: unknown): unknown {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
  const { cost: _cost, tokens: _tokens, children, ...retained } = entry as Record<string, unknown>
  return Array.isArray(children) ? { ...retained, children: children.map(withoutSpend) } : retained
}

/**
 * Strips spend from the execution payloads a permission group withholds.
 *
 * Reaches into trace spans and block executions rather than only blanking the
 * run total: both carry their own `cost` and `tokens`, and a viewer who can sum
 * the spans has not been withheld anything. Deletes rather than relies on the
 * schema, because `executionDataDetailSchema` is a passthrough and a span's own
 * shape is a `catchall`, so a field left in place would survive validation.
 */
export function withheldSpendData(executionData: Record<string, unknown>): Record<string, unknown> {
  const projected: Record<string, unknown> = { ...executionData }
  if (Array.isArray(projected.traceSpans)) {
    projected.traceSpans = projected.traceSpans.map(withoutSpend)
  }
  if (Array.isArray(projected.blockExecutions)) {
    projected.blockExecutions = projected.blockExecutions.map(withoutSpend)
  }
  return projected
}

/**
 * Canonical workflow-log detail loader after workspace authorization. Returns
 * `null` when no matching row exists in either execution-log table.
 *
 * For in-flight (running/pending) executions, live progress markers are merged
 * from Redis, since they are only folded into the row at a terminal/pause
 * boundary.
 */
export async function readLogDetail({
  viewerUserId,
  workspaceId,
  lookupColumn,
  lookupValue,
  signal,
  hideTraceSpans = false,
  hideCostInfo = false,
}: FetchLogDetailArgs): Promise<WorkflowLogDetail | null> {
  signal?.throwIfAborted()
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
      executionOrigin: workflowExecutionOriginSql().as('execution_origin'),
    })
    .from(workflowExecutionLogs)
    .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
    .leftJoin(
      workflowDeploymentVersion,
      eq(workflowDeploymentVersion.id, workflowExecutionLogs.deploymentVersionId)
    )
    .leftJoin(pausedExecutions, eq(pausedExecutions.executionId, workflowExecutionLogs.executionId))
    .where(and(workflowMatch, eq(workflowExecutionLogs.workspaceId, workspaceId)))
    .limit(1)
  signal?.throwIfAborted()

  const log = rows[0]

  if (log) {
    const workflowSummary = log.workflowId
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
      : null

    const totalPauseCount = Number(log.pausedTotalPauseCount ?? 0)
    const resumedCount = Number(log.pausedResumedCount ?? 0)
    const hasPendingPause =
      (totalPauseCount > 0 && resumedCount < totalPauseCount) ||
      (log.pausedStatus !== null && log.pausedStatus !== 'fully_resumed')

    // Cost is sourced exclusively from the usage_log ledger (itemized breakdown)
    // and its cost_total projection (run total). The cost jsonb is never read.
    const costLedger = hideCostInfo ? null : await buildCostLedger(log.executionId)
    signal?.throwIfAborted()
    const totalDollars = costLedger?.total ?? (log.costTotal != null ? Number(log.costTotal) : null)

    // Trace spans / heavy execution data may live in object storage; resolve the
    // pointer here (no-op for inline / pre-externalization rows).
    const materialized = await materializeExecutionDataForDisplay(
      log.executionData as Record<string, unknown> | null,
      {
        workspaceId,
        workflowId: log.workflowId,
        executionId: log.executionId,
        userId: viewerUserId,
      }
    )
    const withheldPayloads = hideTraceSpans ? withheldExecutionData(materialized) : materialized
    const executionData = hideCostInfo ? withheldSpendData(withheldPayloads) : withheldPayloads
    signal?.throwIfAborted()

    // A custom block's child ran in another workspace and kept its spans on its
    // own log row. Join in the ones whose publisher opened them to consumers.
    if (Array.isArray(executionData?.traceSpans)) {
      await hydrateChildTraces(executionData.traceSpans as TraceSpan[], { viewerUserId })
      signal?.throwIfAborted()
    }

    const liveMarkers =
      log.status === 'running' || log.status === 'pending' || log.status === 'redacting'
        ? ((await getProgressMarkers(log.executionId)) ?? {})
        : {}
    signal?.throwIfAborted()
    const rowMarkers = (executionData ?? {}) as ExecutionProgressMarkers
    const mergedStartedBlock = pickLatestStartedMarker(
      liveMarkers.lastStartedBlock,
      rowMarkers.lastStartedBlock
    )
    const mergedCompletedBlock = pickLatestCompletedMarker(
      liveMarkers.lastCompletedBlock,
      rowMarkers.lastCompletedBlock
    )

    return workflowLogDetailSchema.parse({
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
      executionOrigin: log.executionOrigin ?? null,
      createdAt: log.startedAt.toISOString(),
      workflow: workflowSummary,
      jobTitle: null,
      cost: hideCostInfo || totalDollars == null ? null : { total: totalDollars },
      ...(hideCostInfo ? {} : { costLedger }),
      pauseSummary: {
        status: log.pausedStatus ?? null,
        total: totalPauseCount,
        resumed: resumedCount,
      },
      hasPendingPause,
      executionData: {
        totalDuration: log.totalDurationMs,
        ...executionData,
        ...(mergedStartedBlock ? { lastStartedBlock: mergedStartedBlock } : {}),
        ...(mergedCompletedBlock ? { lastCompletedBlock: mergedCompletedBlock } : {}),
        enhanced: true as const,
      },
      files: log.files ?? null,
    })
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
    .where(and(jobMatch, eq(jobExecutionLogs.workspaceId, workspaceId)))
    .limit(1)
  signal?.throwIfAborted()

  const jobLog = jobRows[0]
  if (!jobLog) return null

  const materializedJobData = await materializeExecutionDataForDisplay(
    jobLog.executionData as Record<string, unknown> | null,
    {
      workspaceId,
      workflowId: null,
      executionId: jobLog.executionId,
      userId: viewerUserId,
    }
  )
  const withheldJobPayloads = hideTraceSpans
    ? withheldExecutionData(materializedJobData)
    : materializedJobData
  const execData = hideCostInfo ? withheldSpendData(withheldJobPayloads) : withheldJobPayloads
  signal?.throwIfAborted()
  return workflowLogDetailSchema.parse({
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
    executionOrigin: null,
    createdAt: jobLog.startedAt.toISOString(),
    workflow: null,
    jobTitle: ((execData.trigger as Record<string, unknown> | undefined)?.source as string) ?? null,
    cost: hideCostInfo ? null : jobCostTotal(jobLog.cost),
    pauseSummary: { status: null, total: 0, resumed: 0 },
    hasPendingPause: false,
    executionData: {
      totalDuration: jobLog.totalDurationMs,
      ...execData,
      enhanced: true as const,
    },
    files: null,
  })
}
