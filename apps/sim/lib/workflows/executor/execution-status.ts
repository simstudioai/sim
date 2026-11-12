import { db } from '@sim/db'
import {
  pausedExecutions,
  resumeQueue,
  workflowDeploymentVersion,
  workflowExecutionLogs,
} from '@sim/db/schema'
import { compareStrings } from '@sim/utils/string'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { WorkflowExecutionStatusResponse } from '@/lib/api/contracts/workflows'
import { getJobQueue } from '@/lib/core/async-jobs'
import type { Job } from '@/lib/core/async-jobs/types'
import {
  type FailedTraceBlock,
  findFailedTraceBlock,
} from '@/lib/logs/execution/trace-spans/trace-spans'
import { materializeExecutionDataForDisplayWithBlockOutputs } from '@/lib/logs/execution/trace-store'
import {
  type LogFieldProjection,
  projectCostTotal,
  resolveLogFieldProjection,
} from '@/lib/logs/projection'
import {
  RESUME_EXECUTION_JOB_ID_PREFIX,
  WORKFLOW_EXECUTION_JOB_ID_PREFIX,
} from '@/lib/workflows/executor/execution-job-ids'
import { normalizePausePoints } from '@/lib/workflows/executor/execution-state'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { getAutomaticResumeWaitingMetadata } from '@/lib/workflows/executor/paused-execution-metadata'
import type { PauseInputField, PausePoint, ResumeStatus } from '@/executor/types'
import { extractBaseBlockId } from '@/executor/utils/subflow-node-id-codec'

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
  traceSpans?: unknown
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

/** A point no resume can act on any more: it resumed, or its resumed execution failed. */
function isSettledPausePoint(point: PausePoint): boolean {
  return point.resumeStatus === 'resumed' || point.resumeStatus === 'failed'
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
  input: Pick<GetWorkflowExecutionStatusInput, 'executionId' | 'includeOutput' | 'workflowId'>,
  deploymentVersion: number | null
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
    deploymentVersion,
    paused: null,
    cost: null,
    error: status === 'failed' ? (job.error ?? 'Execution failed') : null,
    finalOutput:
      input.includeOutput && status === 'completed' ? extractJobFinalOutput(job.output) : null,
    blockOutputs: null,
  }
}

interface ResumeAttemptRow {
  id: string
  parentExecutionId: string
  status: string
  queuedAt: Date
  claimedAt: Date | null
  completedAt: Date | null
  failureReason: string | null
}

type SettledResumeAttemptRow = ResumeAttemptRow & { status: 'completed' | 'failed' }

function isSettledResumeAttempt(
  attempt: ResumeAttemptRow | undefined
): attempt is SettledResumeAttemptRow {
  return attempt?.status === 'completed' || attempt?.status === 'failed'
}

/**
 * Projects a finished resume attempt as its own run resource.
 *
 * A resume never writes a log row of its own: it continues the paused run and
 * records under the parent's execution ID, so once its queue entry settles the
 * run it continued is the only durable record of what it did. The attempt
 * keeps its own ID and timings, and borrows the rest from that run.
 *
 * A `completed` attempt is one whose segment ran to its end — the workflow
 * finished, failed, or paused again — so the run's state is the answer,
 * including when a later resume has since moved the run on (which is why an
 * active run reports no end time). A `failed` attempt never finished its
 * segment and may have left the run paused for another attempt; it reads as
 * failed with its recorded reason unless the run itself was cancelled or failed
 * with a more specific error.
 */
function projectSettledResumeAttempt(
  executionId: string,
  attempt: SettledResumeAttemptRow,
  run: WorkflowExecutionStatusResponse
): WorkflowExecutionStatusResponse {
  const startedAt = attempt.claimedAt ?? attempt.queuedAt
  const continuesInRun =
    attempt.status === 'completed' && (run.status === 'queued' || run.status === 'running')
  const endedAt = continuesInRun ? null : attempt.completedAt
  const resource: WorkflowExecutionStatusResponse = {
    ...run,
    executionId,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt?.toISOString() ?? null,
    totalDurationMs: endedAt ? Math.max(0, endedAt.getTime() - startedAt.getTime()) : null,
  }
  if (attempt.status === 'completed') return resource

  const cancelled = run.status === 'cancelled'
  return {
    ...resource,
    status: cancelled ? 'cancelled' : 'failed',
    level: cancelled ? 'info' : 'error',
    paused: null,
    error: cancelled
      ? null
      : ((run.status === 'failed' ? run.error : null) ??
        attempt.failureReason ??
        'Resume execution failed'),
    finalOutput: null,
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

/** A projected status resource together with the projection that produced it. */
export interface ProjectedWorkflowExecutionStatus {
  status: WorkflowExecutionStatusResponse
  projection: LogFieldProjection
  /**
   * The execution whose recorded state answered: the run itself, or the parent run a settled
   * resume attempt continued. Further reads of the run's state (its pause points) use this id.
   */
  stateExecutionId: string
  /**
   * The state execution's raw `pause_points`, already loaded while the run is paused, so
   * {@link readPausedRunPoints} need not read them again; null when the run is not paused.
   */
  pausePoints: unknown
  /**
   * The block a failed run's recorded trace names as its failure, or null when the run did not
   * fail, its trace names none, or the viewer's group withholds execution data.
   *
   * permission-group-enforced: logs.trace_spans
   */
  failedBlock: FailedTraceBlock | null
}

/**
 * Reads the execution status resource, projected for the viewer, and reports
 * the projection alongside it.
 *
 * Projection lives in this shared read rather than in each of its route
 * adapters so the rule has one copy and the next consumer inherits it, and it
 * runs after the caller's authorization, on whichever branch answered.
 *
 * The projection is returned rather than kept private because a caller that
 * appends more of the run's execution data to this resource has to withhold it
 * on the same terms — a run's output *files* are the clearest case. Deriving
 * that answer from the applied projection is what keeps the two from drifting;
 * resolving the viewer's group a second time would be a second copy of the rule.
 */
export async function getProjectedWorkflowExecutionStatus(
  input: GetWorkflowExecutionStatusInput
): Promise<ProjectedWorkflowExecutionStatus | null> {
  const resolved = await readWorkflowExecutionStatus(input)
  if (!resolved) return null
  const projection = await resolveLogFieldProjection(
    input.viewerUserId,
    input.workspaceId,
    input.workspaceOrganizationId
  )
  return {
    status: projectExecutionStatus(resolved.status, projection),
    projection,
    stateExecutionId: resolved.stateExecutionId,
    pausePoints: resolved.pausePoints,
    failedBlock: projection.hideTraceSpans ? null : resolved.failedBlock,
  }
}

/**
 * The projected status resource alone, for a caller that renders nothing beyond
 * it.
 */
export async function getWorkflowExecutionStatus(
  input: GetWorkflowExecutionStatusInput
): Promise<WorkflowExecutionStatusResponse | null> {
  return (await getProjectedWorkflowExecutionStatus(input))?.status ?? null
}

/** Run statuses whose error or final output a poll returns, so it reads their execution data. */
function statusesReadingExecutionData(includeOutput: boolean): string[] {
  return includeOutput ? ['failed', 'completed'] : ['failed']
}

/**
 * `execution_data` only for a row whose status the poll will read it for, so a
 * poll on an in-flight or output-less run does not pull and parse the payload.
 */
function executionDataReadByPoll(
  input: Pick<GetWorkflowExecutionStatusInput, 'includeOutput' | 'selectedOutputs'>
) {
  if (input.selectedOutputs.length > 0) return workflowExecutionLogs.executionData
  return sql<unknown>`CASE WHEN ${inArray(workflowExecutionLogs.status, statusesReadingExecutionData(input.includeOutput))} THEN ${workflowExecutionLogs.executionData} END`.mapWith(
    workflowExecutionLogs.executionData
  )
}

/** The deployment version number a run's log recorded, or null when it recorded none. */
async function readRunDeploymentVersion(
  workflowId: string,
  executionId: string
): Promise<number | null> {
  const [row] = await db
    .select({ version: workflowDeploymentVersion.version })
    .from(workflowExecutionLogs)
    .innerJoin(
      workflowDeploymentVersion,
      eq(workflowDeploymentVersion.id, workflowExecutionLogs.deploymentVersionId)
    )
    .where(
      and(
        eq(workflowExecutionLogs.executionId, executionId),
        eq(workflowExecutionLogs.workflowId, workflowId)
      )
    )
    .limit(1)
  return row?.version ?? null
}

/**
 * A status resource and the execution whose recorded state answered it: the run itself, or
 * for a settled resume attempt with no log row of its own, the parent run it continued.
 */
interface ResolvedExecutionStatus {
  status: WorkflowExecutionStatusResponse
  stateExecutionId: string
  /** The state execution's raw `pause_points`, loaded while it is paused; null otherwise. */
  pausePoints: unknown
  /** The failing block the recorded trace names, when the answered `error` is the run's own. */
  failedBlock: FailedTraceBlock | null
}

async function readWorkflowExecutionStatus(
  input: GetWorkflowExecutionStatusInput
): Promise<ResolvedExecutionStatus | null> {
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
      executionData: executionDataReadByPoll(input),
      costTotal: workflowExecutionLogs.costTotal,
      deploymentVersion: workflowDeploymentVersion.version,
    })
    .from(workflowExecutionLogs)
    .leftJoin(
      workflowDeploymentVersion,
      eq(workflowDeploymentVersion.id, workflowExecutionLogs.deploymentVersionId)
    )
    .where(
      and(
        eq(workflowExecutionLogs.executionId, executionId),
        eq(workflowExecutionLogs.workflowId, workflowId)
      )
    )
    .limit(1)

  const [resumeAttempt] = await db
    .select({
      id: resumeQueue.id,
      parentExecutionId: resumeQueue.parentExecutionId,
      status: resumeQueue.status,
      queuedAt: resumeQueue.queuedAt,
      claimedAt: resumeQueue.claimedAt,
      completedAt: resumeQueue.completedAt,
      failureReason: resumeQueue.failureReason,
    })
    .from(resumeQueue)
    .innerJoin(pausedExecutions, eq(resumeQueue.pausedExecutionId, pausedExecutions.id))
    .where(
      and(eq(resumeQueue.newExecutionId, executionId), eq(pausedExecutions.workflowId, workflowId))
    )
    .orderBy(sql`case ${resumeQueue.status} when 'claimed' then 0 when 'pending' then 1 else 2 end`)
    .limit(1)

  const activeResume =
    resumeAttempt?.status === 'pending' || resumeAttempt?.status === 'claimed'
      ? resumeAttempt
      : undefined

  const hasTerminalLog =
    logRow?.status === 'completed' || logRow?.status === 'failed' || logRow?.status === 'cancelled'
  const projectedResume = hasTerminalLog ? undefined : activeResume

  const queueJobIds = [
    ...(projectedResume?.status === 'claimed'
      ? [`${RESUME_EXECUTION_JOB_ID_PREFIX}${projectedResume.id}`]
      : []),
    ...(!logRow ? [`${WORKFLOW_EXECUTION_JOB_ID_PREFIX}${executionId}`] : []),
  ]

  /**
   * An active resume continues its parent run on the version the parent admitted, so it
   * reports that version before it has a log row of its own, as it does once it settles.
   */
  const deploymentVersion =
    logRow?.deploymentVersion ??
    (projectedResume
      ? await readRunDeploymentVersion(workflowId, projectedResume.parentExecutionId)
      : null)

  if (queueJobIds.length > 0) {
    const jobQueue = await getJobQueue()
    for (const jobId of queueJobIds) {
      const job = await jobQueue.getJob(jobId)
      if (!job || job.metadata.workflowId !== workflowId) continue
      return {
        status: projectQueueJob(job, { executionId, includeOutput, workflowId }, deploymentVersion),
        stateExecutionId: executionId,
        pausePoints: null,
        failedBlock: null,
      }
    }
  }

  if (projectedResume) {
    const startedAt = projectedResume.claimedAt ?? projectedResume.queuedAt
    const status: WorkflowExecutionStatusResponse = {
      executionId,
      workflowId,
      status: 'queued',
      trigger: logRow?.trigger ?? 'api',
      level: 'info',
      startedAt: startedAt.toISOString(),
      endedAt: null,
      totalDurationMs: null,
      deploymentVersion,
      paused: null,
      cost: null,
      error: null,
      finalOutput: null,
      blockOutputs: null,
    }
    return { status, stateExecutionId: executionId, pausePoints: null, failedBlock: null }
  }

  if (!logRow) {
    if (!isSettledResumeAttempt(resumeAttempt)) return null
    const run = await readWorkflowExecutionStatus({
      ...input,
      executionId: resumeAttempt.parentExecutionId,
    })
    if (!run) return null
    const status = projectSettledResumeAttempt(executionId, resumeAttempt, run.status)
    return {
      status,
      stateExecutionId: run.stateExecutionId,
      pausePoints: run.pausePoints,
      failedBlock:
        status.status === 'failed' && run.status.status === 'failed' ? run.failedBlock : null,
    }
  }

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
    .where(
      and(
        eq(pausedExecutions.executionId, executionId),
        eq(pausedExecutions.workflowId, workflowId)
      )
    )
    .limit(1)

  /**
   * An open pause record makes the run read `paused` unless the log has finished and no point
   * is left to resume: a resume that ran and failed marks its point `failed` and fails the log
   * but leaves the record open, and that point can never be resumed again.
   */
  const isCurrentlyPaused =
    !!pausedRow &&
    (pausedRow.status === 'paused' || pausedRow.status === 'partially_resumed') &&
    !(hasTerminalLog && normalizePausePoints(pausedRow.pausePoints).every(isSettledPausePoint))

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

  const resource = {
    executionId: logRow.executionId,
    // Column is `set null` on workflow delete; the caller's param is the fallback.
    workflowId: logRow.workflowId ?? workflowId,
    status,
    trigger: logRow.trigger,
    level: logRow.level,
    startedAt: logRow.startedAt.toISOString(),
    endedAt: logRow.endedAt?.toISOString() ?? null,
    totalDurationMs: logRow.totalDurationMs ?? null,
    deploymentVersion: logRow.deploymentVersion ?? null,
    paused,
    cost,
  }

  // Mirrors the three output conditions below; a poll needing none skips the archive read.
  const readsExecutionData =
    selectedOutputs.length > 0 || statusesReadingExecutionData(includeOutput).includes(status)
  if (!readsExecutionData) {
    return {
      status: { ...resource, error: null, finalOutput: null, blockOutputs: null },
      stateExecutionId: executionId,
      pausePoints: paused ? pausedRow?.pausePoints : null,
      failedBlock: null,
    }
  }

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
    status: { ...resource, error, finalOutput, blockOutputs },
    stateExecutionId: executionId,
    pausePoints: paused ? pausedRow?.pausePoints : null,
    failedBlock: error ? findFailedTraceBlock(executionData?.traceSpans, error) : null,
  }
}

/**
 * Most pause points a run detail lists. A run that pauses again after resuming keeps its
 * resumed points, so a run over the cap keeps every point not yet resumed before any resumed
 * one: the points a caller can still act on are never crowded out by history.
 */
const MAX_PAUSED_RUN_POINTS = 100

/** At most {@link MAX_PAUSED_RUN_POINTS}, keeping unresolved points in preference to resumed ones, earliest registered first. */
function capPausePoints<P extends PausePoint>(points: P[]): P[] {
  const byRegistration = (a: P, b: P) => compareStrings(a.registeredAt ?? '', b.registeredAt ?? '')
  const sorted = [...points].sort(byRegistration)
  if (sorted.length <= MAX_PAUSED_RUN_POINTS) return sorted
  const unresolved = sorted.filter((point) => point.resumeStatus !== 'resumed')
  const resumed = sorted.filter((point) => point.resumeStatus === 'resumed')
  return [...unresolved, ...resumed].slice(0, MAX_PAUSED_RUN_POINTS).sort(byRegistration)
}

/** One pause point of a paused run, as a caller reading the run may see it. */
export interface PausedRunPoint {
  contextId: string
  blockId: string
  blockName: string | null
  kind: 'human' | 'time'
  status: ResumeStatus
  /** Null for a point recorded without a registration time. */
  registeredAt: string | null
  resumeAt: string | null
  parallel: { parallelId: string; branchIndex: number; branchTotal: number | null } | null
  loop: { loopId: string; iteration: number } | null
  inputFields: PauseInputField[] | null
  display: unknown
  queuePosition: number | null
}

/**
 * Names of `blockIds` in the deployment version the run executed, read inside the
 * database so the version's state never leaves it. Empty for a run with no recorded
 * version (a manual run) or whose version no longer exists.
 */
async function readRunBlockNames(
  workflowId: string,
  executionId: string,
  blockIds: string[]
): Promise<Map<string, string>> {
  if (blockIds.length === 0) return new Map()
  const [row] = await db
    .select({
      names: sql<Record<string, string | null> | null>`(
        select jsonb_object_agg(b.key, b.value ->> 'name')
        from json_each(${workflowDeploymentVersion.state} -> 'blocks') as b
        where b.key in (${sql.join(
          blockIds.map((id) => sql`${id}`),
          sql`, `
        )})
      )`,
    })
    .from(workflowExecutionLogs)
    .innerJoin(
      workflowDeploymentVersion,
      eq(workflowDeploymentVersion.id, workflowExecutionLogs.deploymentVersionId)
    )
    .where(
      and(
        eq(workflowExecutionLogs.executionId, executionId),
        eq(workflowExecutionLogs.workflowId, workflowId)
      )
    )
    .limit(1)
  const names = new Map<string, string>()
  for (const [id, name] of Object.entries(row?.names ?? {})) {
    if (typeof name === 'string' && name) names.set(id, name)
  }
  return names
}

/**
 * The pause points of a paused run, earliest registered first and capped at
 * {@link MAX_PAUSED_RUN_POINTS} (unresolved points kept first), or null when the run has no
 * paused record.
 *
 * Reads only `pause_points`, never the execution snapshot. `display` and
 * `inputFields` come only from points scrubbed of the run's resolved secrets when
 * they were captured; an older point's stored response was never scrubbed, so both
 * are null for it. Resume links and API-mode response status and headers are never
 * part of a point.
 *
 * A caller that already loaded the paused record's `pause_points` passes them as
 * `pausePoints` and the record is not read again. A caller that lists only some
 * points passes `only`, applied before the cap so the points it keeps are never
 * crowded out by ones it would discard.
 */
export async function readPausedRunPoints(input: {
  workflowId: string
  executionId: string
  pausePoints?: unknown
  only?: (point: PausePoint) => boolean
}): Promise<PausedRunPoint[] | null> {
  const { workflowId, executionId } = input
  const row =
    input.pausePoints !== undefined
      ? { pausePoints: input.pausePoints }
      : (
          await db
            .select({ pausePoints: pausedExecutions.pausePoints })
            .from(pausedExecutions)
            .where(
              and(
                eq(pausedExecutions.executionId, executionId),
                eq(pausedExecutions.workflowId, workflowId)
              )
            )
            .limit(1)
        )[0]
  if (!row) return null

  // Positions count the whole pending queue, so it is read unpaged: it holds a few columns per
  // waiting point, never more than the `pause_points` already loaded above.
  const pendingResumes = await db
    .select({
      contextId: resumeQueue.contextId,
      status: resumeQueue.status,
      queuedAt: resumeQueue.queuedAt,
    })
    .from(resumeQueue)
    .where(and(eq(resumeQueue.parentExecutionId, executionId), eq(resumeQueue.status, 'pending')))
    .orderBy(resumeQueue.queuedAt)
  const queuePositions = PauseResumeManager.computeQueuePositions(
    pendingResumes.map((entry) => ({
      contextId: entry.contextId,
      status: entry.status,
      queuedAt: entry.queuedAt?.toISOString() ?? null,
    }))
  )

  const mapped = PauseResumeManager.mapPausePoints(row.pausePoints, queuePositions)
  const points = capPausePoints(input.only ? mapped.filter(input.only) : mapped)
  const baseBlockId = (point: PausePoint) => extractBaseBlockId(point.blockId ?? point.contextId)
  const names = await readRunBlockNames(workflowId, executionId, [
    ...new Set(points.map(baseBlockId)),
  ])

  return points.map((point) => {
    const blockId = baseBlockId(point)
    return {
      contextId: point.contextId,
      blockId,
      blockName: names.get(blockId) ?? null,
      kind: point.pauseKind === 'time' ? 'time' : 'human',
      status: point.resumeStatus,
      registeredAt: point.registeredAt ?? null,
      resumeAt: point.resumeAt ?? null,
      parallel: point.parallelScope
        ? {
            parallelId: point.parallelScope.parallelId,
            branchIndex: point.parallelScope.branchIndex,
            branchTotal: point.parallelScope.branchTotal ?? null,
          }
        : null,
      loop: point.loopScope
        ? { loopId: point.loopScope.loopId, iteration: point.loopScope.iteration }
        : null,
      inputFields: point.inputFields ?? null,
      display: point.display ?? null,
      queuePosition: point.queuePosition ?? null,
    }
  })
}

/**
 * Pause points as a viewer may see them. A point's `display` is what the block
 * rendered from upstream outputs, so it follows `finalOutput`'s gating: withheld
 * unless output was asked for and the viewer's group shows execution data.
 * `inputFields` are resolved before the pause is captured, so a label or
 * description can carry upstream values too: they are withheld from a viewer
 * whose group hides execution data.
 *
 * The one copy of this rule, so every surface that lists pause points reveals
 * no more than the run detail does.
 *
 * permission-group-enforced: logs.trace_spans
 */
export function projectPausedRunPoints(
  points: readonly PausedRunPoint[],
  options: { projection: LogFieldProjection; includeOutput: boolean }
): PausedRunPoint[] {
  const hidesExecutionData = options.projection.hideTraceSpans
  const showsDisplay = options.includeOutput && !hidesExecutionData
  return points.map((point) => ({
    ...point,
    display: showsDisplay ? point.display : null,
    inputFields: hidesExecutionData ? null : point.inputFields,
  }))
}
