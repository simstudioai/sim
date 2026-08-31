import { db } from '@sim/db'
import { pausedExecutions, resumeQueue, workflowExecutionLogs } from '@sim/db/schema'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { WorkflowExecutionStatusResponse } from '@/lib/api/contracts/workflows'
import { getJobQueue } from '@/lib/core/async-jobs'
import type { Job } from '@/lib/core/async-jobs/types'
import { materializeExecutionDataForDisplayWithBlockOutputs } from '@/lib/logs/execution/trace-store'
import {
  type LogFieldProjection,
  projectCostTotal,
  resolveLogFieldProjection,
} from '@/lib/logs/log-projection'
import {
  RESUME_EXECUTION_JOB_ID_PREFIX,
  WORKFLOW_EXECUTION_JOB_ID_PREFIX,
} from '@/lib/workflows/executor/execution-job-ids'
import { getAutomaticResumeWaitingMetadata } from '@/lib/workflows/executor/paused-execution-metadata'
import type { PausePoint } from '@/executor/types'

/**
 * Reads a single execution's status resource — the log row, the paused-state
 * overlay, and (when requested) materialized outputs. Extracted so the v1 and
 * v2 status routes render the identical resource from one read path.
 * Auth is the caller's responsibility. Before a worker writes the durable log
 * row, the deterministic queue record is projected as the same execution
 * resource so callers never need a separate job identifier or endpoint.
 */

type LogStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

interface ExecutionDataShape {
  finalOutput?: { error?: string } & Record<string, unknown>
  error?: { message?: string } | string
  completionFailure?: string
}

function resolvePath(value: unknown, path: string[]): unknown {
  let current: unknown = value
  for (const segment of path) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function pickSelectedOutputs(
  selectedOutputs: string[],
  blockOutputs: Map<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const selector of selectedOutputs) {
    const [head, ...rest] = selector.split('.')
    if (!head) continue
    if (!blockOutputs.has(head)) continue
    const blockValue = blockOutputs.get(head)
    out[selector] = rest.length === 0 ? blockValue : resolvePath(blockValue, rest)
  }
  return out
}

function pickEarliestPausePoint(points: PausePoint[]): PausePoint | null {
  const active = points.filter((p) => p.resumeStatus === 'paused')
  if (active.length === 0) return null
  return active.reduce<PausePoint | null>((best, current) => {
    if (!best) return current
    if (!current.resumeAt) return best
    if (!best.resumeAt) return current
    return current.resumeAt < best.resumeAt ? current : best
  }, null)
}

function normalizePausePoints(raw: unknown): PausePoint[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw as PausePoint[]
  if (typeof raw === 'object') return Object.values(raw as Record<string, PausePoint>)
  return []
}

function extractError(executionData: unknown): string | null {
  if (!executionData || typeof executionData !== 'object') return null
  const data = executionData as ExecutionDataShape
  if (typeof data.error === 'string') return data.error
  if (data.error && typeof data.error === 'object' && typeof data.error.message === 'string') {
    return data.error.message
  }
  if (typeof data.finalOutput?.error === 'string') return data.finalOutput.error
  if (typeof data.completionFailure === 'string') return data.completionFailure
  return null
}

function extractJobFinalOutput(output: unknown): unknown | null {
  if (!output || typeof output !== 'object' || !('output' in output)) return null
  return (output as Record<string, unknown>).output ?? null
}

function projectQueueJob(
  job: Job,
  input: Pick<GetWorkflowExecutionStatusInput, 'executionId' | 'includeOutput' | 'workflowId'>
): WorkflowExecutionStatusResponse {
  const status: WorkflowExecutionStatusResponse['status'] =
    job.status === 'pending' ? 'queued' : job.status === 'processing' ? 'running' : job.status
  const startedAt = job.startedAt ?? job.createdAt
  const endedAt = job.completedAt ?? null

  return {
    executionId: input.executionId,
    workflowId: input.workflowId,
    status,
    trigger: job.metadata.correlation?.triggerType ?? 'api',
    level: status === 'failed' ? 'error' : 'info',
    startedAt: startedAt.toISOString(),
    endedAt: endedAt?.toISOString() ?? null,
    totalDurationMs: endedAt ? endedAt.getTime() - startedAt.getTime() : null,
    paused: null,
    cost: null,
    error: status === 'failed' ? (job.error ?? 'Execution failed') : null,
    finalOutput:
      input.includeOutput && status === 'completed' ? extractJobFinalOutput(job.output) : null,
    blockOutputs: null,
  }
}

export interface GetWorkflowExecutionStatusInput {
  workflowId: string
  executionId: string
  includeOutput: boolean
  selectedOutputs: string[]
  /**
   * The workspace the caller already authorized against. Passed in rather than
   * read off the log row because this resource also answers from the job queue,
   * for a run that has no log row yet — and that branch must be projected too.
   */
  workspaceId: string
  /**
   * The user whose permission group governs the projection, or `null`/`undefined`
   * when none does — a workspace API key (which authorizes as the workspace and
   * whose reported user is only the key's creator) and an executor delegation
   * (which carries a role but no capabilities) both read whole.
   *
   * Required rather than optional on purpose: a new consumer of this read has to
   * name its subject to compile, instead of silently inheriting an unprojected
   * response.
   */
  viewerUserId: string | null | undefined
  /** The workspace's organization, when the caller already loaded it. */
  workspaceOrganizationId?: string | null
}

/**
 * Applies a viewer's log projection to a run-detail resource.
 *
 * `finalOutput` and `blockOutputs` are the run-shaped spellings of `finalOutput`
 * and `blockExecutions` on the withheld list in `withheldExecutionData` — the
 * same per-block execution detail the log-detail path strips — so
 * `logs.trace_spans` withholds them here too. A caller that could still name a
 * block in `selectedOutputs` and get its output back would read exactly what the
 * detail surface refuses, one query parameter later.
 *
 * `status`, `error` and the timings stay: these are projections, not gates, and
 * withholding whether a run failed is not what the two capabilities restrict.
 *
 * permission-group-enforced: logs.trace_spans
 * permission-group-enforced: logs.cost
 */
function projectExecutionStatus(
  status: WorkflowExecutionStatusResponse,
  projection: LogFieldProjection
): WorkflowExecutionStatusResponse {
  if (!projection.hideCostInfo && !projection.hideTraceSpans) return status
  return {
    ...status,
    cost: projectCostTotal(status.cost?.total ?? null, projection),
    finalOutput: projection.hideTraceSpans ? null : status.finalOutput,
    blockOutputs: projection.hideTraceSpans ? null : status.blockOutputs,
  }
}

/**
 * Reads the execution status resource, projected for the viewer.
 *
 * Projection lives in this shared read rather than in each of its two route
 * adapters so the rule has one copy and the next consumer inherits it, and it
 * runs after the caller's authorization, on whichever branch answered.
 */
export async function getWorkflowExecutionStatus(
  input: GetWorkflowExecutionStatusInput
): Promise<WorkflowExecutionStatusResponse | null> {
  const status = await readWorkflowExecutionStatus(input)
  if (!status) return null
  const projection = await resolveLogFieldProjection(
    input.viewerUserId,
    input.workspaceId,
    input.workspaceOrganizationId
  )
  return projectExecutionStatus(status, projection)
}

async function readWorkflowExecutionStatus(
  input: GetWorkflowExecutionStatusInput
): Promise<WorkflowExecutionStatusResponse | null> {
  const { workflowId, executionId, includeOutput, selectedOutputs } = input

  const [logRow] = await db
    .select({
      executionId: workflowExecutionLogs.executionId,
      workflowId: workflowExecutionLogs.workflowId,
      workspaceId: workflowExecutionLogs.workspaceId,
      status: workflowExecutionLogs.status,
      level: workflowExecutionLogs.level,
      trigger: workflowExecutionLogs.trigger,
      startedAt: workflowExecutionLogs.startedAt,
      endedAt: workflowExecutionLogs.endedAt,
      totalDurationMs: workflowExecutionLogs.totalDurationMs,
      executionData: workflowExecutionLogs.executionData,
      costTotal: workflowExecutionLogs.costTotal,
    })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.executionId, executionId),
        eq(workflowExecutionLogs.workflowId, workflowId)
      )
    )
    .limit(1)

  const [activeResume] = await db
    .select({
      id: resumeQueue.id,
      status: resumeQueue.status,
      queuedAt: resumeQueue.queuedAt,
      claimedAt: resumeQueue.claimedAt,
    })
    .from(resumeQueue)
    .innerJoin(pausedExecutions, eq(resumeQueue.pausedExecutionId, pausedExecutions.id))
    .where(
      and(
        eq(resumeQueue.newExecutionId, executionId),
        eq(pausedExecutions.workflowId, workflowId),
        inArray(resumeQueue.status, ['pending', 'claimed'] as const)
      )
    )
    .orderBy(sql`case when ${resumeQueue.status} = 'claimed' then 0 else 1 end`)
    .limit(1)

  const hasTerminalLog =
    logRow?.status === 'completed' || logRow?.status === 'failed' || logRow?.status === 'cancelled'
  const projectedResume = hasTerminalLog ? undefined : activeResume

  const queueJobIds = [
    ...(projectedResume?.status === 'claimed'
      ? [`${RESUME_EXECUTION_JOB_ID_PREFIX}${projectedResume.id}`]
      : []),
    ...(!logRow ? [`${WORKFLOW_EXECUTION_JOB_ID_PREFIX}${executionId}`] : []),
  ]

  if (queueJobIds.length > 0) {
    const jobQueue = await getJobQueue()
    for (const jobId of queueJobIds) {
      const job = await jobQueue.getJob(jobId)
      if (!job || job.metadata.workflowId !== workflowId) continue
      return projectQueueJob(job, { executionId, includeOutput, workflowId })
    }
  }

  if (projectedResume) {
    const startedAt = projectedResume.claimedAt ?? projectedResume.queuedAt
    return {
      executionId,
      workflowId,
      status: 'queued',
      trigger: logRow?.trigger ?? 'api',
      level: 'info',
      startedAt: startedAt.toISOString(),
      endedAt: null,
      totalDurationMs: null,
      paused: null,
      cost: null,
      error: null,
      finalOutput: null,
      blockOutputs: null,
    }
  }

  if (!logRow) return null

  const [pausedRow] = await db
    .select({
      id: pausedExecutions.id,
      status: pausedExecutions.status,
      pausePoints: pausedExecutions.pausePoints,
      metadata: pausedExecutions.metadata,
      resumedCount: pausedExecutions.resumedCount,
      pausedAt: pausedExecutions.pausedAt,
      nextResumeAt: pausedExecutions.nextResumeAt,
    })
    .from(pausedExecutions)
    .where(eq(pausedExecutions.executionId, executionId))
    .limit(1)

  const isCurrentlyPaused =
    !!pausedRow && (pausedRow.status === 'paused' || pausedRow.status === 'partially_resumed')

  let status: WorkflowExecutionStatusResponse['status']
  if (isCurrentlyPaused) {
    status = 'paused'
  } else {
    status = logRow.status as LogStatus
  }

  let paused: WorkflowExecutionStatusResponse['paused'] = null
  if (isCurrentlyPaused && pausedRow) {
    const points = normalizePausePoints(pausedRow.pausePoints)
    const earliest = pickEarliestPausePoint(points)
    const automaticResumeWaiting = getAutomaticResumeWaitingMetadata(pausedRow.metadata)
    paused = {
      contextId: earliest?.contextId ?? null,
      pausedAt: pausedRow.pausedAt.toISOString(),
      resumeAt: pausedRow.nextResumeAt?.toISOString() ?? earliest?.resumeAt ?? null,
      pauseKind: earliest?.pauseKind ?? null,
      blockedOnBlockId: earliest?.blockId ?? null,
      automaticResumeWaitingReason:
        automaticResumeWaiting?.reason ?? earliest?.automaticResumeWaitingReason ?? null,
      pausedExecutionId: pausedRow.id,
      pausePointCount: points.length,
      resumedCount: pausedRow.resumedCount,
    }
  }

  const cost = logRow.costTotal != null ? { total: Number(logRow.costTotal) } : null

  const requestedBlockIds = [
    ...new Set(selectedOutputs.map((selector) => selector.split('.')[0]).filter(Boolean)),
  ]
  const materialized = await materializeExecutionDataForDisplayWithBlockOutputs(
    logRow.executionData as Record<string, unknown> | null,
    {
      workspaceId: logRow.workspaceId,
      workflowId: logRow.workflowId,
      executionId: logRow.executionId,
    },
    requestedBlockIds
  )
  const executionData = materialized.executionData as ExecutionDataShape

  const error = status === 'failed' ? extractError(executionData) : null

  const finalOutput =
    includeOutput && status === 'completed' && executionData
      ? (executionData.finalOutput ?? null)
      : null

  const blockOutputs =
    selectedOutputs.length > 0
      ? pickSelectedOutputs(selectedOutputs, materialized.blockOutputs)
      : null

  return {
    executionId: logRow.executionId,
    // Column is `set null` on workflow delete; the caller's param is the fallback.
    workflowId: logRow.workflowId ?? workflowId,
    status,
    trigger: logRow.trigger,
    level: logRow.level,
    startedAt: logRow.startedAt.toISOString(),
    endedAt: logRow.endedAt?.toISOString() ?? null,
    totalDurationMs: logRow.totalDurationMs ?? null,
    paused,
    cost,
    error,
    finalOutput,
    blockOutputs,
  }
}
