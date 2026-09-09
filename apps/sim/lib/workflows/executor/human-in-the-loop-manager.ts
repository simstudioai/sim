import { dbFor } from '@sim/db'
import { pausedExecutions, resumeQueue, workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike, omit } from '@sim/utils/object'
import type { Edge } from '@xyflow/react'
import { and, asc, desc, eq, inArray, lt, type SQL, sql } from 'drizzle-orm'
import { releaseExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import { assertBillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import {
  createTimeoutAbortController,
  getAsyncExecutionTimeoutForBillingAttribution,
  getExecutionDeadlineAt,
  getTimeoutErrorMessage,
  type TimeoutAbortController,
} from '@/lib/core/execution-limits'
import {
  createExecutionEventWriter,
  flushExecutionStreamReplayBuffer,
  initializeExecutionStreamMeta,
  markExecutionStreamTerminal,
  resetExecutionStreamBuffer,
  type TerminalExecutionStreamStatus,
} from '@/lib/execution/event-buffer'
import {
  registerManualExecutionAborter,
  unregisterManualExecutionAborter,
} from '@/lib/execution/manual-cancellation'
import {
  collectLargeValueReferenceKeys,
  replaceLargeValueReferenceKeysWithClient,
} from '@/lib/execution/payloads/large-value-metadata'
import { compactBlockLogs, compactExecutionPayload } from '@/lib/execution/payloads/serializer'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import {
  cancelledExecutionLogFields,
  terminalExecutionLogFields,
} from '@/lib/logs/execution/cancellation'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { cleanupExecutionBase64Cache } from '@/lib/uploads/utils/user-file-base64.server'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import {
  type ExecutionEvent,
  LIVE_ONLY_EXECUTION_EVENT_TYPES,
} from '@/lib/workflows/executor/execution-events'
import {
  createPausedExecutionResumeMetadata,
  parsePausedExecutionResumeMetadata,
} from '@/lib/workflows/executor/paused-execution-metadata'
import {
  type AutomaticResumeWaitingMetadata,
  normalizeAutomaticResumeWaitingReason,
  resolveAutomaticResumeAdmissionFailure,
} from '@/lib/workflows/executor/resume-policy'
import {
  forwardAgentStreamToExecutionEvents,
  shouldForwardAnswerTextFromSink,
} from '@/lib/workflows/streaming/forward-agent-stream-events'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type {
  BlockCompletionCallbackData,
  ChildWorkflowContext,
  ExecutionCallbacks,
  IterationContext,
  SerializableExecutionState,
} from '@/executor/execution/types'
import type {
  BlockLog,
  ExecutionResult,
  PauseKind,
  PausePoint,
  SerializedSnapshot,
  StreamingExecution,
} from '@/executor/types'
import { hasExecutionResult } from '@/executor/utils/errors'
import { filterOutputForLog } from '@/executor/utils/output-filter'
import { projectResolvedSecretDiagnosticError } from '@/executor/utils/resolved-secret-content-projection'
import type { SerializedConnection } from '@/serializer/types'

/**
 * All paused-execution / resume-queue / execution-log persistence in this
 * module runs on the exec pool, mirroring the completion writes in
 * `lib/logs/execution/logger.ts`.
 */
const execDb = dbFor('exec')

const logger = createLogger('HumanInTheLoopManager')
const RUN_BUFFER_UNAVAILABLE_ERROR = 'Run buffer temporarily unavailable'
const RESUMABLE_PAUSED_STATUSES = ['paused', 'partially_resumed'] as const
const CANCELLABLE_PAUSED_STATUSES = ['paused', 'partially_resumed'] as const
const AUTOMATIC_RESUME_INTERVENTION_PREFIX = 'Automatic resume requires manual intervention: '
const PAUSED_CANCELLATION_QUEUE_FAILURE_REASON = 'Paused execution cancellation requested'

async function releaseCancelledResumeReservations(
  resumeEntryIds: readonly string[]
): Promise<void> {
  await Promise.all(
    resumeEntryIds.map(async (resumeEntryId) => {
      try {
        await releaseExecutionSlot(resumeEntryId)
      } catch (error) {
        logger.warn('Failed to release cancelled resume reservation', {
          resumeEntryId,
          error: toError(error).message,
        })
      }
    })
  )
}

/**
 * A resume attempt that was not admitted, carrying the status the caller should
 * see. Every admission refusal must be raised through this rather than a bare
 * `Error`: the resume surfaces classify a failure by its `statusCode`, so an
 * untyped throw for an ordinary client mistake — a stale `contextId`, an
 * already-resumed pause — reaches the caller as a `500`.
 *
 * `retryable` says whether an automatic resume should try the attempt again.
 * Only a pause still finalizing its snapshot is; a pause that is absent, in the
 * wrong state, or of the wrong kind will read the same on every retry.
 *
 * Messages must stay free of identifiers, snapshot contents, and ORM detail —
 * they are forwarded verbatim to API callers.
 */
class ResumeAdmissionError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'ResumeAdmissionError'
  }
}

/** Matches the paused execution mode to the deployment recorded on its durable root log. */
export function requireResumeDeploymentVersion(
  useDraftState: unknown,
  deploymentVersionId: string | null
): string | undefined {
  if (typeof useDraftState !== 'boolean') {
    throw new ResumeAdmissionError('Execution mode is missing from the paused run', 409, false)
  }
  if (useDraftState) {
    if (deploymentVersionId !== null) {
      throw new ResumeAdmissionError(
        'Paused draft execution cannot resume from a deployment version',
        409,
        false
      )
    }
    return undefined
  }
  if (!deploymentVersionId) {
    throw new ResumeAdmissionError(
      'Paused deployed execution is missing its deployment version',
      409,
      false
    )
  }
  return deploymentVersionId
}

function isPausedOutputForContext(output: unknown, contextId: string): boolean {
  if (!isRecordLike(output)) return false
  const metadata = output._pauseMetadata
  return isRecordLike(metadata) && metadata.contextId === contextId
}

export function updateResumeOutputInAggregationBuffers(
  state: SerializableExecutionState,
  stateBlockKey: string,
  pauseBlockId: string,
  contextId: string,
  mergedOutput: Record<string, unknown>
): void {
  for (const scope of Object.values(state.loopExecutions ?? {})) {
    if (!isRecordLike(scope) || !isRecordLike(scope.currentIterationOutputs)) continue

    const outputs = scope.currentIterationOutputs
    const pausedEntry =
      outputs[stateBlockKey] !== undefined
        ? stateBlockKey
        : outputs[pauseBlockId] !== undefined
          ? pauseBlockId
          : undefined

    if (pausedEntry !== undefined && isPausedOutputForContext(outputs[pausedEntry], contextId)) {
      if (pausedEntry !== stateBlockKey) {
        delete outputs[pausedEntry]
      }
      outputs[stateBlockKey] = mergedOutput
    }
  }

  for (const scope of Object.values(state.parallelExecutions ?? {})) {
    if (!isRecordLike(scope) || !isRecordLike(scope.branchOutputs)) continue

    for (const [branchIndex, branchOutputs] of Object.entries(scope.branchOutputs)) {
      if (!Array.isArray(branchOutputs)) continue

      const outputIndex = branchOutputs.findIndex((output) =>
        isPausedOutputForContext(output, contextId)
      )
      if (outputIndex !== -1) {
        scope.branchOutputs[branchIndex] = [
          ...branchOutputs.slice(0, outputIndex),
          mergedOutput,
          ...branchOutputs.slice(outputIndex + 1),
        ]
      }
    }
  }
}

function parseSnapshotForReferenceTracking(snapshotSeed: SerializedSnapshot): unknown {
  try {
    return { ...snapshotSeed, snapshot: JSON.parse(snapshotSeed.snapshot) }
  } catch {
    return snapshotSeed
  }
}

function getSnapshotWorkspaceId(snapshotValue: unknown): string | undefined {
  if (!isRecordLike(snapshotValue)) return undefined
  const metadata = snapshotValue.metadata
  if (!isRecordLike(metadata)) return undefined
  return typeof metadata.workspaceId === 'string' ? metadata.workspaceId : undefined
}

function isResumablePausedStatus(status: string): boolean {
  return RESUMABLE_PAUSED_STATUSES.includes(status as (typeof RESUMABLE_PAUSED_STATUSES)[number])
}

function updatePausePointResumeStateSql(
  contextId: string,
  resumeStatus: PausePoint['resumeStatus'],
  automaticResumeWaitingReason?: string
): SQL {
  if (automaticResumeWaitingReason) {
    return sql`jsonb_set(
      jsonb_set(${pausedExecutions.pausePoints}, ARRAY[${contextId}, 'resumeStatus'], ${JSON.stringify(resumeStatus)}::jsonb),
      ARRAY[${contextId}, 'automaticResumeWaitingReason'],
      ${JSON.stringify(automaticResumeWaitingReason)}::jsonb,
      true
    )`
  }

  return sql`jsonb_set(
    ${pausedExecutions.pausePoints} #- ARRAY[${contextId}, 'automaticResumeWaitingReason'],
    ARRAY[${contextId}, 'resumeStatus'],
    ${JSON.stringify(resumeStatus)}::jsonb
  )`
}

function setPausePointAutomaticResumeWaitingReasonSql(contextId: string, reason: string): SQL {
  return sql`jsonb_set(
    ${pausedExecutions.pausePoints},
    ARRAY[${contextId}, 'automaticResumeWaitingReason'],
    ${JSON.stringify(reason)}::jsonb,
    true
  )`
}

function setAutomaticResumeWaitingMetadataSql(waiting: AutomaticResumeWaitingMetadata): SQL {
  return sql`jsonb_set(
    ${pausedExecutions.metadata},
    '{automaticResumeWaiting}',
    ${JSON.stringify(waiting)}::jsonb,
    true
  )`
}

function clearAutomaticResumeWaitingMetadataSql(contextId: string): SQL {
  return sql`CASE
    WHEN ${pausedExecutions.metadata}->'automaticResumeWaiting'->>'contextId' = ${contextId}
      THEN ${pausedExecutions.metadata} - 'automaticResumeWaiting'
    ELSE ${pausedExecutions.metadata}
  END`
}

/**
 * The terminal columns a `workflow_execution_logs` row keeps when a partial
 * resume moves it back to `pending`.
 *
 * The revival claim excludes only `cancelled`, so it also matches a row
 * `markResumeFailed` already ended: one context's resume fails, a sibling
 * context resumes successfully afterwards, and the run becomes live again
 * carrying the end timestamp and duration of the attempt that failed. A live row
 * must not carry a terminal stamp — and because `elapsedDurationMsSql` preserves
 * a `pending` row's `total_duration_ms` as its pause checkpoint, leaving it
 * there also hands the next terminal write a duration frozen at the failed
 * resume rather than one it recomputes.
 *
 * A row revived from a non-terminal status is the opposite case: its columns are
 * the checkpoint `completeWithPause` banked, which is precisely what that
 * preservation rule exists to keep, so they survive untouched. The row's own
 * status decides, read — like every expression in the same `SET` — against the
 * pre-update row.
 */
const revivedExecutionLogStamp = {
  endedAt: sql<Date | null>`CASE WHEN ${workflowExecutionLogs.status} IN ('failed', 'completed') THEN NULL ELSE ${workflowExecutionLogs.endedAt} END`,
  totalDurationMs: sql<
    number | null
  >`CASE WHEN ${workflowExecutionLogs.status} IN ('failed', 'completed') THEN NULL ELSE ${workflowExecutionLogs.totalDurationMs} END`,
}

function withoutAutomaticResumeWaitingReason(
  point: Record<string, unknown>
): Record<string, unknown> {
  return omit(point, ['automaticResumeWaitingReason'])
}

function withoutAutomaticResumeWaitingMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  return omit(metadata, ['automaticResumeWaiting'])
}

function getAutomaticResumeAdmissionReason(
  reason: string,
  state: AutomaticResumeWaitingMetadata['state']
): string {
  return normalizeAutomaticResumeWaitingReason(
    state === 'intervention_required' ? `${AUTOMATIC_RESUME_INTERVENTION_PREFIX}${reason}` : reason
  )
}

interface ResumeQueueEntrySummary {
  id: string
  pausedExecutionId: string
  parentExecutionId: string
  newExecutionId: string
  contextId: string
  resumeInput: unknown
  status: string
  queuedAt: string | null
  claimedAt: string | null
  completedAt: string | null
  failureReason: string | null
}

interface PausePointWithQueue extends PausePoint {
  queuePosition?: number | null
  latestResumeEntry?: ResumeQueueEntrySummary | null
}

interface PausedExecutionSummary {
  id: string
  workflowId: string
  executionId: string
  status: string
  totalPauseCount: number
  resumedCount: number
  pausedAt: string | null
  updatedAt: string | null
  expiresAt: string | null
  metadata: Record<string, any> | null
  triggerIds: string[]
  pausePoints: PausePointWithQueue[]
}

interface PausedExecutionDetail extends PausedExecutionSummary {
  executionSnapshot: SerializedSnapshot
  queue: ResumeQueueEntrySummary[]
}

interface PauseContextDetail {
  execution: PausedExecutionSummary
  pausePoint: PausePointWithQueue
  queue: ResumeQueueEntrySummary[]
  activeResumeEntry?: ResumeQueueEntrySummary | null
}

interface PersistPauseResultArgs {
  workflowId: string
  executionId: string
  /** Initial execution id or durable resume-queue id that owns the reservation. */
  reservationId?: string
  pausePoints: PausePoint[]
  snapshotSeed: SerializedSnapshot
  executorUserId?: string
}

interface EnqueueResumeArgs {
  executionId: string
  workflowId: string
  contextId: string
  resumeInput: unknown
  userId: string
  /** Restrict which `pauseKind`s are eligible to resume. Defaults to allowing any. */
  allowedPauseKinds?: PauseKind[]
}

type EnqueueResumeResult =
  | {
      status: 'queued'
      resumeExecutionId: string
      queuePosition: number
    }
  | {
      status: 'starting'
      resumeExecutionId: string
      resumeEntryId: string
      pausedExecution: typeof pausedExecutions.$inferSelect
      contextId: string
      resumeInput: unknown
      userId: string
    }

interface StartResumeExecutionArgs {
  resumeEntryId: string
  resumeExecutionId: string
  pausedExecution: typeof pausedExecutions.$inferSelect
  contextId: string
  resumeInput: unknown
  userId: string
  sendEvent?: (event: ExecutionEvent) => void
  onStream?: (streamingExec: StreamingExecution) => Promise<void>
  onBlockComplete?: (blockId: string, data: BlockCompletionCallbackData) => Promise<void>
  abortSignal?: AbortSignal
}

export interface ActiveResumeCancellationTarget {
  resumeEntryId: string
  pausedExecutionId: string
  parentExecutionId: string
  resumeExecutionId: string
}

export type PausedCancellationStage =
  | { kind: 'not_paused' }
  | { kind: 'idle' }
  | { kind: 'active_resume'; target: ActiveResumeCancellationTarget }

/**
 * Starts a new active-attempt deadline from the immutable payer snapshot saved
 * in bounded pause metadata. Legacy rows extract only the leading snapshot
 * metadata object. The controller therefore exists before any resume log claim
 * or full snapshot reconstruction, while an upstream deadline remains earlier.
 */
export function createResumeAttemptTimeoutController(
  snapshotSeed: SerializedSnapshot,
  parentSignal?: AbortSignal,
  pausedExecutionMetadata?: unknown
): TimeoutAbortController {
  const persistedResumeMetadata = parsePausedExecutionResumeMetadata(pausedExecutionMetadata)
  const billingAttribution = persistedResumeMetadata
    ? persistedResumeMetadata.billingAttribution
    : extractResumeBillingAttributionFromSnapshot(snapshotSeed)
  return createTimeoutAbortController(
    getAsyncExecutionTimeoutForBillingAttribution(billingAttribution),
    parentSignal
  )
}

/**
 * Reads only the leading snapshot metadata object used by `ExecutionSnapshot.toJSON`.
 * This admits the attempt before reconstructing the potentially large workflow state.
 */
export function extractResumeBillingAttributionFromSnapshot(
  snapshotSeed: SerializedSnapshot
): ReturnType<typeof assertBillingAttributionSnapshot> {
  const prefix = /^\s*\{\s*"metadata"\s*:\s*/.exec(snapshotSeed.snapshot)
  const metadataStart = prefix?.[0].length
  if (metadataStart === undefined || snapshotSeed.snapshot[metadataStart] !== '{') {
    throw new Error('Paused execution snapshot metadata is missing')
  }

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = metadataStart; index < snapshotSeed.snapshot.length; index++) {
    const character = snapshotSeed.snapshot[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      continue
    }
    if (character === '{') depth++
    else if (character === '}') depth--
    if (depth !== 0) continue

    const metadata = JSON.parse(snapshotSeed.snapshot.slice(metadataStart, index + 1))
    return createPausedExecutionResumeMetadata({ metadata }).billingAttribution
  }

  throw new Error('Paused execution snapshot metadata is malformed')
}

/**
 * Returns the earliest `resumeAt` across `pauseKind: 'time'` pause points whose
 * `resumeAt` is a valid date and (when `after` is provided) strictly later than it.
 * Returns `null` when no candidate exists.
 */
export function computeEarliestResumeAt(
  points: Iterable<Pick<PausePoint, 'pauseKind' | 'resumeAt'>>,
  options: { after?: Date } = {}
): Date | null {
  const { after } = options
  let earliest: Date | null = null
  for (const point of points) {
    if (point.pauseKind !== 'time' || !point.resumeAt) continue
    const candidate = new Date(point.resumeAt)
    if (Number.isNaN(candidate.getTime())) continue
    if (after && candidate <= after) continue
    if (!earliest || candidate < earliest) earliest = candidate
  }
  return earliest
}

export class PauseResumeManager {
  static async persistPauseResult(args: PersistPauseResultArgs): Promise<void> {
    const {
      workflowId,
      executionId,
      reservationId = executionId,
      pausePoints,
      snapshotSeed,
      executorUserId,
    } = args
    const snapshotReferenceValue = parseSnapshotForReferenceTracking(snapshotSeed)
    const snapshotValue = isRecordLike(snapshotReferenceValue)
      ? snapshotReferenceValue.snapshot
      : undefined
    const resumeMetadata = createPausedExecutionResumeMetadata(snapshotValue, executorUserId)
    const snapshotWorkspaceId = resumeMetadata.workspaceId
    const snapshotReferenceKeys = snapshotWorkspaceId
      ? collectLargeValueReferenceKeys(snapshotReferenceValue, snapshotWorkspaceId)
      : []

    const pausePointsRecord = pausePoints.reduce<Record<string, any>>((acc, point) => {
      acc[point.contextId] = {
        contextId: point.contextId,
        blockId: PauseResumeManager.normalizePauseBlockId(point.blockId ?? point.contextId),
        response: point.response,
        resumeStatus: point.resumeStatus,
        snapshotReady: point.snapshotReady,
        registeredAt: point.registeredAt,
        parallelScope: point.parallelScope,
        loopScope: point.loopScope,
        resumeLinks: point.resumeLinks,
        pauseKind: point.pauseKind,
        resumeAt: point.resumeAt,
      }
      return acc
    }, {})

    const nextResumeAt = computeEarliestResumeAt(pausePoints)

    const now = new Date()
    const metadata = {
      pauseScope: 'execution',
      triggerIds: snapshotSeed.triggerIds,
      ...resumeMetadata,
    }

    let shouldProcessQueuedResumes = true

    await execDb.transaction(async (tx) => {
      const executionLog = await tx
        .select({ status: workflowExecutionLogs.status })
        .from(workflowExecutionLogs)
        .where(
          and(
            eq(workflowExecutionLogs.executionId, executionId),
            eq(workflowExecutionLogs.workflowId, workflowId)
          )
        )
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      const existing = await tx
        .select()
        .from(pausedExecutions)
        .where(eq(pausedExecutions.executionId, executionId))
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      if (executionLog?.status === 'cancelled') {
        shouldProcessQueuedResumes = false
        if (existing && existing.status !== 'cancelled') {
          await tx
            .update(pausedExecutions)
            .set({ status: 'cancelled', updatedAt: now, nextResumeAt: null })
            .where(eq(pausedExecutions.id, existing.id))
        }
        return
      }

      if (existing?.status === 'cancelled') {
        shouldProcessQueuedResumes = false
        return
      }

      if (!existing) {
        await tx.insert(pausedExecutions).values({
          id: generateId(),
          workflowId,
          executionId,
          executionSnapshot: snapshotSeed,
          pausePoints: pausePointsRecord,
          totalPauseCount: pausePoints.length,
          resumedCount: 0,
          automaticResumeRetryCount: 0,
          status: 'paused',
          metadata,
          pausedAt: now,
          updatedAt: now,
          nextResumeAt,
        })
        if (snapshotWorkspaceId) {
          await replaceLargeValueReferenceKeysWithClient(
            tx,
            {
              workspaceId: snapshotWorkspaceId,
              workflowId,
              executionId,
              source: 'paused_snapshot',
            },
            snapshotReferenceKeys
          )
        }
        return
      }

      const existingPausePoints = (existing.pausePoints as Record<string, any>) ?? {}
      const mergedPausePoints = Object.fromEntries(
        Object.entries(existingPausePoints).map(([contextId, point]) => [
          contextId,
          point?.resumeStatus === 'resuming'
            ? {
                ...withoutAutomaticResumeWaitingReason(point),
                resumeStatus: 'resumed',
                resumedAt: now.toISOString(),
              }
            : point,
        ])
      )

      for (const [contextId, point] of Object.entries(pausePointsRecord)) {
        mergedPausePoints[contextId] = point
      }

      const mergedPoints = Object.values(mergedPausePoints)
      const resumedCount = mergedPoints.filter((point) => point?.resumeStatus === 'resumed').length
      const totalPauseCount = mergedPoints.length
      const mergedNextResumeAt = computeEarliestResumeAt(mergedPoints as PausePoint[])
      const nextStatus =
        existing.status === 'cancelling'
          ? 'cancelling'
          : totalPauseCount > 0 && resumedCount >= totalPauseCount
            ? 'fully_resumed'
            : resumedCount > 0
              ? 'partially_resumed'
              : 'paused'
      shouldProcessQueuedResumes = nextStatus !== 'cancelling'

      await tx
        .update(pausedExecutions)
        .set({
          workflowId,
          executionSnapshot: snapshotSeed,
          pausePoints: mergedPausePoints,
          totalPauseCount,
          resumedCount,
          automaticResumeRetryCount: 0,
          status: nextStatus,
          // Merge rather than replace: foreign keys like `cellContext` (stashed
          // by the table cell task) live on the same metadata column and must
          // survive a re-pause so chained-wait resumes can still write the row back.
          metadata: {
            ...(isRecordLike(existing.metadata)
              ? withoutAutomaticResumeWaitingMetadata(existing.metadata)
              : {}),
            ...metadata,
          },
          updatedAt: now,
          nextResumeAt: mergedNextResumeAt,
        })
        .where(eq(pausedExecutions.id, existing.id))

      if (snapshotWorkspaceId) {
        await replaceLargeValueReferenceKeysWithClient(
          tx,
          {
            workspaceId: snapshotWorkspaceId,
            workflowId,
            executionId,
            source: 'paused_snapshot',
          },
          snapshotReferenceKeys
        )
      }
    })

    await releaseExecutionSlot(reservationId)
    if (shouldProcessQueuedResumes) {
      await PauseResumeManager.processQueuedResumes(executionId, workflowId)
    }
  }

  static async enqueueOrStartResume(args: EnqueueResumeArgs): Promise<EnqueueResumeResult> {
    const { executionId, workflowId, contextId, resumeInput, userId, allowedPauseKinds } = args

    return await execDb.transaction(async (tx) => {
      const pausedExecution = await tx
        .select()
        .from(pausedExecutions)
        .where(
          and(
            eq(pausedExecutions.executionId, executionId),
            eq(pausedExecutions.workflowId, workflowId)
          )
        )
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      if (!pausedExecution) {
        throw new ResumeAdmissionError('Paused execution not found or already resumed', 404, false)
      }

      if (!isResumablePausedStatus(pausedExecution.status)) {
        throw new ResumeAdmissionError('Paused execution is not resumable', 409, false)
      }

      const pausePoints = pausedExecution.pausePoints as Record<string, any>
      const pausePoint = pausePoints?.[contextId]
      if (!pausePoint) {
        throw new ResumeAdmissionError('Pause point not found for execution', 404, false)
      }
      if (pausePoint.resumeStatus !== 'paused') {
        throw new ResumeAdmissionError('Pause point already resumed or in progress', 409, false)
      }
      if (!pausePoint.snapshotReady) {
        throw new ResumeAdmissionError(
          'Snapshot not ready; execution still finalizing pause',
          409,
          true
        )
      }

      const pauseKind: PauseKind = pausePoint.pauseKind ?? 'human'
      if (allowedPauseKinds && !allowedPauseKinds.includes(pauseKind)) {
        throw new ResumeAdmissionError(
          `Pause kind '${pauseKind}' is not allowed for this resume endpoint (allowed: ${allowedPauseKinds.join(', ')})`,
          400,
          false
        )
      }

      const activeResume = await tx
        .select({ id: resumeQueue.id })
        .from(resumeQueue)
        .where(
          and(
            eq(resumeQueue.parentExecutionId, executionId),
            inArray(resumeQueue.status, ['claimed'] as const)
          )
        )
        .limit(1)
        .then((rows) => rows[0])

      const resumeExecutionId = generateId()
      const now = new Date()

      if (activeResume) {
        const [entry] = await tx
          .insert(resumeQueue)
          .values({
            id: generateId(),
            pausedExecutionId: pausedExecution.id,
            parentExecutionId: executionId,
            newExecutionId: resumeExecutionId,
            contextId,
            resumeInput: resumeInput ?? null,
            status: 'pending',
            queuedAt: now,
          })
          .returning({ id: resumeQueue.id, queuedAt: resumeQueue.queuedAt })

        await tx
          .update(pausedExecutions)
          .set({
            pausePoints: updatePausePointResumeStateSql(contextId, 'queued'),
            metadata: clearAutomaticResumeWaitingMetadataSql(contextId),
          })
          .where(eq(pausedExecutions.id, pausedExecution.id))

        pausePoint.resumeStatus = 'queued'
        pausePoint.automaticResumeWaitingReason = undefined

        const [positionRow = { position: 0 }] = await tx
          .select({ position: sql<number>`count(*)` })
          .from(resumeQueue)
          .where(
            and(
              eq(resumeQueue.parentExecutionId, executionId),
              eq(resumeQueue.status, 'pending'),
              lt(resumeQueue.queuedAt, entry.queuedAt)
            )
          )

        return {
          status: 'queued',
          resumeExecutionId,
          queuePosition: Number(positionRow.position ?? 0) + 1,
        }
      }

      const resumeEntryId = generateId()
      await tx.insert(resumeQueue).values({
        id: resumeEntryId,
        pausedExecutionId: pausedExecution.id,
        parentExecutionId: executionId,
        newExecutionId: resumeExecutionId,
        contextId,
        resumeInput: resumeInput ?? null,
        status: 'claimed',
        queuedAt: now,
        claimedAt: now,
      })

      await tx
        .update(pausedExecutions)
        .set({
          pausePoints: updatePausePointResumeStateSql(contextId, 'resuming'),
          metadata: clearAutomaticResumeWaitingMetadataSql(contextId),
        })
        .where(eq(pausedExecutions.id, pausedExecution.id))

      pausePoint.resumeStatus = 'resuming'
      pausePoint.automaticResumeWaitingReason = undefined

      return {
        status: 'starting',
        resumeExecutionId,
        resumeEntryId,
        pausedExecution,
        contextId,
        resumeInput,
        userId,
      }
    })
  }

  static async startResumeExecution(args: StartResumeExecutionArgs): Promise<ExecutionResult> {
    const {
      resumeEntryId,
      resumeExecutionId,
      pausedExecution,
      contextId,
      resumeInput,
      userId,
      sendEvent,
      onStream,
      onBlockComplete,
      abortSignal,
    } = args

    const pausePointsRecord = pausedExecution.pausePoints as Record<string, any>
    const pausePointForContext = pausePointsRecord?.[contextId]
    const pauseBlockId = PauseResumeManager.normalizePauseBlockId(
      pausePointForContext?.blockId ?? pausePointForContext?.contextId ?? contextId
    )

    let attemptTimeoutController: TimeoutAbortController | undefined
    try {
      attemptTimeoutController = createResumeAttemptTimeoutController(
        pausedExecution.executionSnapshot as SerializedSnapshot,
        abortSignal,
        pausedExecution.metadata
      )
      registerManualExecutionAborter(resumeExecutionId, attemptTimeoutController.abort)
      const result = await PauseResumeManager.runResumeExecution({
        reservationId: resumeEntryId,
        resumeExecutionId,
        pausedExecution,
        contextId,
        resumeInput,
        userId,
        sendEvent,
        onStream,
        onBlockComplete,
        abortSignal: attemptTimeoutController.signal,
      })

      if (result.status === 'paused') {
        const effectiveExecutionId = result.metadata?.executionId ?? resumeExecutionId
        if (!result.snapshotSeed) {
          logger.error('Missing snapshot seed for paused resume execution', {
            resumeExecutionId,
          })
          await LoggingSession.markExecutionAsFailed(
            effectiveExecutionId,
            'Missing snapshot seed for paused execution',
            undefined,
            pausedExecution.workflowId
          )
          await releaseExecutionSlot(resumeEntryId)
        } else {
          try {
            await PauseResumeManager.persistPauseResult({
              workflowId: pausedExecution.workflowId,
              executionId: effectiveExecutionId,
              reservationId: resumeEntryId,
              pausePoints: result.pausePoints || [],
              snapshotSeed: result.snapshotSeed,
              executorUserId: result.metadata?.userId,
            })
          } catch (pauseError) {
            logger.error(
              'Failed to persist pause result for resumed execution',
              projectResolvedSecretDiagnosticError(pauseError, undefined, {
                resumeExecutionId,
              })
            )
            await LoggingSession.markExecutionAsFailed(
              effectiveExecutionId,
              `Failed to persist pause state: ${toError(pauseError).message}`,
              undefined,
              pausedExecution.workflowId
            )
            await releaseExecutionSlot(resumeEntryId)
          }
        }
      } else {
        if (result.status === 'cancelled') {
          await PauseResumeManager.markResumeAttemptFailed({
            resumeEntryId,
            pausedExecutionId: pausedExecution.id,
            parentExecutionId: pausedExecution.executionId,
            contextId,
            failureReason: 'Resume execution cancelled',
          })
          const pausedCancellationStatus = await PauseResumeManager.getPausedCancellationStatus(
            pausedExecution.executionId,
            pausedExecution.workflowId
          )
          if (pausedCancellationStatus === 'cancelling') {
            await PauseResumeManager.completePausedCancellation(
              pausedExecution.executionId,
              pausedExecution.workflowId
            )
          }
        } else {
          await PauseResumeManager.updateSnapshotAfterResume({
            pausedExecutionId: pausedExecution.id,
            contextId,
            pauseBlockId: pauseBlockId,
            executionState: result.executionState,
          })
          await PauseResumeManager.markResumeCompleted({
            resumeEntryId,
            pausedExecutionId: pausedExecution.id,
            parentExecutionId: pausedExecution.executionId,
            contextId,
          })
        }
      }

      if (result.status === 'paused') {
        await PauseResumeManager.markResumeCompleted({
          resumeEntryId,
          pausedExecutionId: pausedExecution.id,
          parentExecutionId: pausedExecution.executionId,
        })
      }

      await PauseResumeManager.processQueuedResumes(
        pausedExecution.executionId,
        pausedExecution.workflowId
      )

      return result
    } catch (error) {
      const message = toError(error).message
      await releaseExecutionSlot(resumeEntryId)
      if (error instanceof ResumeAdmissionError) {
        await PauseResumeManager.markResumeAttemptFailed({
          resumeEntryId,
          pausedExecutionId: pausedExecution.id,
          parentExecutionId: pausedExecution.executionId,
          contextId,
          failureReason: message,
          preserveForRetry: true,
          retryable: error.retryable,
        })
      } else if (message === RUN_BUFFER_UNAVAILABLE_ERROR) {
        await PauseResumeManager.markResumeAttemptFailed({
          resumeEntryId,
          pausedExecutionId: pausedExecution.id,
          parentExecutionId: pausedExecution.executionId,
          contextId,
          failureReason: message,
        })
      } else {
        await PauseResumeManager.markResumeFailed({
          resumeEntryId,
          pausedExecutionId: pausedExecution.id,
          parentExecutionId: pausedExecution.executionId,
          contextId,
          failureReason: message,
        })
      }
      logger.error(
        'Resume execution failed',
        projectResolvedSecretDiagnosticError(error, undefined, {
          parentExecutionId: pausedExecution.executionId,
          resumeExecutionId,
          contextId,
        })
      )
      if (!(error instanceof ResumeAdmissionError)) {
        await PauseResumeManager.processQueuedResumes(
          pausedExecution.executionId,
          pausedExecution.workflowId
        )
      }
      throw error
    } finally {
      if (attemptTimeoutController) {
        unregisterManualExecutionAborter(resumeExecutionId, attemptTimeoutController.abort)
      }
      attemptTimeoutController?.cleanup()
    }
  }

  private static async claimResumeExecutionLog(args: {
    parentExecutionId: string
    workflowId: string
    executionDeadlineAt?: Date
  }): Promise<{ deploymentVersionId: string | null }> {
    const { parentExecutionId, workflowId, executionDeadlineAt } = args
    const [claimedExecution] = await execDb
      .update(workflowExecutionLogs)
      .set({ status: 'running', executionDeadlineAt: executionDeadlineAt ?? null })
      .where(
        and(
          eq(workflowExecutionLogs.executionId, parentExecutionId),
          eq(workflowExecutionLogs.workflowId, workflowId),
          inArray(workflowExecutionLogs.status, ['pending', 'paused'])
        )
      )
      .returning({
        id: workflowExecutionLogs.id,
        deploymentVersionId: workflowExecutionLogs.deploymentVersionId,
      })

    if (!claimedExecution) {
      throw new ResumeAdmissionError('Execution can no longer be resumed', 409, false)
    }
    return { deploymentVersionId: claimedExecution.deploymentVersionId }
  }

  private static async runResumeExecution(args: {
    reservationId: string
    resumeExecutionId: string
    pausedExecution: typeof pausedExecutions.$inferSelect
    contextId: string
    resumeInput: unknown
    userId: string
    sendEvent?: (event: ExecutionEvent) => void
    onStream?: (streamingExec: StreamingExecution) => Promise<void>
    onBlockComplete?: (blockId: string, data: BlockCompletionCallbackData) => Promise<void>
    abortSignal?: AbortSignal
  }): Promise<ExecutionResult> {
    const {
      reservationId,
      resumeExecutionId,
      pausedExecution,
      contextId,
      resumeInput,
      userId,
      sendEvent,
      onStream: externalOnStream,
      onBlockComplete: externalOnBlockComplete,
      abortSignal: externalAbortSignal,
    } = args
    const parentExecutionId = pausedExecution.executionId
    const executionDeadlineAt = getExecutionDeadlineAt(externalAbortSignal)

    const claimedExecution = await PauseResumeManager.claimResumeExecutionLog({
      parentExecutionId,
      workflowId: pausedExecution.workflowId,
      executionDeadlineAt,
    })

    logger.info('Starting resume execution', {
      resumeExecutionId,
      parentExecutionId: pausedExecution.executionId,
      contextId,
      hasResumeInput: !!resumeInput,
    })

    const serializedSnapshot = pausedExecution.executionSnapshot as SerializedSnapshot
    const baseSnapshot = ExecutionSnapshot.fromJSON(serializedSnapshot.snapshot)
    const resumeDeploymentVersionId = requireResumeDeploymentVersion(
      baseSnapshot.metadata.useDraftState,
      claimedExecution.deploymentVersionId
    )
    const billingAttribution = assertBillingAttributionSnapshot(
      baseSnapshot.metadata.billingAttribution
    )
    const effectiveUserId =
      userId.trim() ||
      (typeof baseSnapshot.metadata.userId === 'string'
        ? baseSnapshot.metadata.userId.trim()
        : '') ||
      billingAttribution.actorUserId

    logger.info('Loaded snapshot from paused execution', {
      workflowId: baseSnapshot.workflow?.version,
      workflowBlockCount: baseSnapshot.workflow?.blocks?.length,
      hasState: !!baseSnapshot.state,
      snapshotMetadata: baseSnapshot.metadata,
    })

    const pausePoints = pausedExecution.pausePoints as Record<string, any>
    const pausePoint = pausePoints?.[contextId]
    if (!pausePoint) {
      throw new Error('Pause point not found for resume execution')
    }

    logger.info('Resume pause point identified', {
      contextId,
      pausePointKeys: Object.keys(pausePoints),
    })

    // Find the blocks downstream of the pause block
    const rawPauseBlockId = pausePoint.blockId ?? contextId
    const pauseBlockId = PauseResumeManager.normalizePauseBlockId(rawPauseBlockId)

    const dagIncomingEdgesFromSnapshot: Record<string, string[]> | undefined =
      baseSnapshot.state?.dagIncomingEdges

    const downstreamBlocks = dagIncomingEdgesFromSnapshot
      ? Object.entries(dagIncomingEdgesFromSnapshot)
          .filter(
            ([, incoming]) =>
              Array.isArray(incoming) &&
              incoming.some(
                (sourceId) => PauseResumeManager.normalizePauseBlockId(sourceId) === pauseBlockId
              )
          )
          .map(([nodeId]) => nodeId)
      : baseSnapshot.workflow.connections
          .filter(
            (conn: SerializedConnection) =>
              PauseResumeManager.normalizePauseBlockId(conn.source) === pauseBlockId
          )
          .map((conn: SerializedConnection) => conn.target)

    logger.info('Found downstream blocks', {
      pauseBlockId,
      downstreamBlocks,
    })

    const stateCopy = baseSnapshot.state
      ? {
          ...baseSnapshot.state,
          blockStates: { ...baseSnapshot.state.blockStates },
        }
      : undefined

    logger.info('Preparing resume state', {
      hasStateCopy: !!stateCopy,
      existingBlockStatesCount: stateCopy ? Object.keys(stateCopy.blockStates).length : 0,
      executedBlocksCount: stateCopy?.executedBlocks?.length ?? 0,
    })

    let terminalResumeOutput: Record<string, any> | undefined

    if (stateCopy) {
      const dagIncomingEdges: Record<string, string[]> | undefined =
        stateCopy.dagIncomingEdges || dagIncomingEdgesFromSnapshot

      // Calculate the pause duration (time from pause to resume)
      const pauseDurationMs = pausedExecution.pausedAt
        ? Date.now() - new Date(pausedExecution.pausedAt).getTime()
        : 0

      logger.info('Calculated pause duration', {
        pauseBlockId,
        pauseDurationMs,
        pausedAt: pausedExecution.pausedAt,
        resumedAt: new Date().toISOString(),
      })

      // Set the pause block as completed with the resume input
      const existingBlockState =
        stateCopy.blockStates[pauseBlockId] ?? stateCopy.blockStates[contextId]

      const stateBlockKey = rawPauseBlockId

      const existingBlockStateWithRaw = stateCopy.blockStates[stateBlockKey] ?? existingBlockState

      const pauseBlockState = existingBlockStateWithRaw ?? {
        output: {},
        executed: true,
        executionTime: 0,
      }
      const normalizedResumeInputRaw = (() => {
        if (!resumeInput) return {}
        if (typeof resumeInput === 'string') {
          try {
            return JSON.parse(resumeInput)
          } catch {
            return { value: resumeInput }
          }
        }
        if (typeof resumeInput === 'object' && !Array.isArray(resumeInput)) {
          return resumeInput
        }
        return { value: resumeInput }
      })()

      const submissionPayload =
        isRecordLike(normalizedResumeInputRaw) && isRecordLike(normalizedResumeInputRaw.submission)
          ? (normalizedResumeInputRaw.submission as Record<string, any>)
          : (normalizedResumeInputRaw as Record<string, any>)

      const existingOutput = pauseBlockState.output || {}
      const existingResponse = existingOutput.response || {}
      const existingResponseData =
        existingResponse &&
        typeof existingResponse.data === 'object' &&
        !Array.isArray(existingResponse.data)
          ? existingResponse.data
          : {}

      const submittedAt = new Date().toISOString()

      const mergedResponseData = {
        ...existingResponseData,
        submission: submissionPayload,
        submittedAt,
      }

      const mergedResponse = {
        ...existingResponse,
        data: mergedResponseData,
        status: existingResponse.status ?? 200,
        headers: existingResponse.headers ?? { 'Content-Type': 'application/json' },
        resume: existingResponse.resume ?? existingOutput.resume,
      }

      const mergedOutput: Record<string, unknown> = {
        ...existingOutput,
        response: mergedResponse,
        submission: submissionPayload,
        resumeInput: normalizedResumeInputRaw,
        submittedAt,
        _resumed: true,
        _resumedFrom: pausedExecution.executionId,
        _pauseDurationMs: pauseDurationMs,
      }

      if (pausePoint.pauseKind === 'time') {
        mergedOutput.status = 'completed'
      }

      mergedOutput.resume = mergedOutput.resume ?? mergedResponse.resume

      // Preserve url and resumeEndpoint from resume links
      const resumeLinks = mergedOutput.resume ?? mergedResponse.resume
      if (resumeLinks && typeof resumeLinks === 'object') {
        if (resumeLinks.uiUrl) {
          mergedOutput.url = resumeLinks.uiUrl
        }
        if (resumeLinks.apiUrl) {
          mergedOutput.resumeEndpoint = resumeLinks.apiUrl
        }
      }

      for (const [key, value] of Object.entries(submissionPayload)) {
        mergedOutput[key] = value
      }

      pauseBlockState.output = mergedOutput
      terminalResumeOutput = mergedOutput
      pauseBlockState.executed = true
      pauseBlockState.executionTime = pauseDurationMs
      if (stateBlockKey !== pauseBlockId && stateCopy.blockStates[pauseBlockId]) {
        delete stateCopy.blockStates[pauseBlockId]
      }

      if (stateBlockKey !== contextId && stateCopy.blockStates[contextId]) {
        delete stateCopy.blockStates[contextId]
      }

      stateCopy.blockStates[stateBlockKey] = pauseBlockState
      updateResumeOutputInAggregationBuffers(
        stateCopy,
        stateBlockKey,
        pauseBlockId,
        contextId,
        mergedOutput
      )

      // Update the block log entry with the merged output so logs show the submission data
      if (Array.isArray(stateCopy.blockLogs)) {
        const blockLogIndex = stateCopy.blockLogs.findIndex(
          (log: { blockId: string }) =>
            log.blockId === stateBlockKey ||
            log.blockId === pauseBlockId ||
            log.blockId === contextId
        )
        if (blockLogIndex !== -1) {
          // Filter output for logging using shared utility
          // 'resume' is redundant with url/resumeEndpoint so we filter it out.
          // The type is only used to read the block's `outputs` for `hiddenFromDisplay`,
          // and v2 inherits that map from v1 verbatim — so both versions filter alike.
          const filteredOutput = filterOutputForLog('human_in_the_loop', mergedOutput, {
            additionalHiddenKeys: ['resume'],
          })
          stateCopy.blockLogs[blockLogIndex] = {
            ...stateCopy.blockLogs[blockLogIndex],
            blockId: stateBlockKey,
            output: filteredOutput,
            durationMs: pauseDurationMs,
            endedAt: new Date().toISOString(),
          }
        }
      }

      if (Array.isArray(stateCopy.executedBlocks)) {
        const filtered = stateCopy.executedBlocks.filter(
          (id: string) => id !== pauseBlockId && id !== contextId
        )
        if (!filtered.includes(stateBlockKey)) {
          filtered.push(stateBlockKey)
        }
        stateCopy.executedBlocks = filtered
      }

      // Track all pause contexts that have already been resumed
      const completedPauseContexts = new Set<string>(
        (stateCopy.completedPauseContexts ?? []).map((id: string) =>
          PauseResumeManager.normalizePauseBlockId(id)
        )
      )
      completedPauseContexts.add(pauseBlockId)

      // Store edges to remove (all edges FROM any completed pause block)
      let edgesToRemove: Edge[]

      if (dagIncomingEdges) {
        const seen = new Set<string>()
        edgesToRemove = []

        for (const [targetNodeId, incomingEdges] of Object.entries(dagIncomingEdges)) {
          if (!Array.isArray(incomingEdges)) continue

          for (const sourceNodeId of incomingEdges) {
            const normalizedSource = PauseResumeManager.normalizePauseBlockId(sourceNodeId)
            if (!completedPauseContexts.has(normalizedSource)) {
              continue
            }

            const key = `${sourceNodeId}→${targetNodeId}`
            if (seen.has(key)) {
              continue
            }
            seen.add(key)

            edgesToRemove.push({
              id: key,
              source: sourceNodeId,
              target: targetNodeId,
            })
          }
        }

        // If we didn't find any edges via the DAG snapshot, fall back to workflow connections
        if (edgesToRemove.length === 0 && baseSnapshot.workflow.connections?.length) {
          edgesToRemove = baseSnapshot.workflow.connections
            .filter((conn: SerializedConnection) =>
              completedPauseContexts.has(PauseResumeManager.normalizePauseBlockId(conn.source))
            )
            .map((conn: SerializedConnection) => ({
              id: `${conn.source}→${conn.target}`,
              source: conn.source,
              target: conn.target,
              sourceHandle: conn.sourceHandle,
              targetHandle: conn.targetHandle,
            }))
        }
      } else {
        edgesToRemove = baseSnapshot.workflow.connections
          .filter((conn: SerializedConnection) =>
            completedPauseContexts.has(PauseResumeManager.normalizePauseBlockId(conn.source))
          )
          .map((conn: SerializedConnection) => ({
            id: `${conn.source}→${conn.target}`,
            source: conn.source,
            target: conn.target,
            sourceHandle: conn.sourceHandle,
            targetHandle: conn.targetHandle,
          }))
      }

      // Persist state updates
      stateCopy.completedPauseContexts = Array.from(completedPauseContexts)
      stateCopy.remainingEdges = edgesToRemove
      stateCopy.pendingQueue = [] // Let the engine determine what's ready after removing edges
      stateCopy.resumeTerminalNoop = edgesToRemove.length === 0

      logger.info('Updated pause block state for resume', {
        pauseBlockId,
        downstreamBlocks,
        edgesToRemove: edgesToRemove.length,
        completedPauseContexts: stateCopy.completedPauseContexts,
        pauseBlockOutput: pauseBlockState.output,
      })
    }

    const metadata = {
      ...baseSnapshot.metadata,
      executionId: resumeExecutionId,
      requestId: baseSnapshot.metadata.requestId,
      startTime: new Date().toISOString(),
      userId: effectiveUserId,
      sessionUserId: baseSnapshot.metadata.sessionUserId,
      workflowUserId: baseSnapshot.metadata.workflowUserId,
      useDraftState: baseSnapshot.metadata.useDraftState,
      isClientSession: baseSnapshot.metadata.isClientSession,
      resumeFromSnapshot: true,
      resumeTerminalNoop: stateCopy?.resumeTerminalNoop === true,
    }

    const resumeSnapshot = new ExecutionSnapshot(
      metadata,
      baseSnapshot.workflow,
      resumeInput ?? {},
      baseSnapshot.workflowVariables || {},
      baseSnapshot.selectedOutputs || [],
      stateCopy
    )

    logger.info('Created resume snapshot', {
      metadata,
      hasWorkflow: !!baseSnapshot.workflow,
      hasState: !!stateCopy,
      pendingQueue: stateCopy?.pendingQueue,
    })

    const triggerType =
      (metadata.triggerType as 'api' | 'webhook' | 'schedule' | 'manual' | 'chat' | undefined) ??
      'manual'
    const loggingSession = new LoggingSession(
      metadata.workflowId,
      parentExecutionId,
      triggerType,
      metadata.requestId,
      reservationId
    )

    logger.info('Running preprocessing checks for resume', {
      resumeExecutionId,
      workflowId: pausedExecution.workflowId,
      userId: effectiveUserId,
    })

    const preprocessingResult = await preprocessExecution({
      workflowId: pausedExecution.workflowId,
      userId: effectiveUserId,
      triggerType: 'manual', // Resume is manual
      executionId: parentExecutionId,
      reservationId,
      requestId: metadata.requestId,
      checkRateLimit: false, // Manual actions bypass rate limits
      checkDeployment: false, // Resuming existing execution
      logPreprocessingErrors: false,
      workspaceId: baseSnapshot.metadata.workspaceId,
      loggingSession,
      billingAttribution,
      executionType: 'async',
      executionDeadlineAt: executionDeadlineAt?.getTime(),
    })

    if (!preprocessingResult.success) {
      const errorMessage =
        preprocessingResult.error?.message || 'Preprocessing check failed for resume execution'
      logger.error('Resume preprocessing failed', {
        resumeExecutionId,
        workflowId: pausedExecution.workflowId,
        userId: effectiveUserId,
        error: errorMessage,
      })

      throw new ResumeAdmissionError(
        errorMessage,
        preprocessingResult.error?.statusCode ?? 500,
        preprocessingResult.error?.retryable ?? false
      )
    }

    logger.info('Preprocessing checks passed for resume', {
      resumeExecutionId,
      actorUserId: preprocessingResult.actorUserId,
    })

    if (preprocessingResult.actorUserId) {
      metadata.userId = preprocessingResult.actorUserId
    }

    logger.info('Invoking executeWorkflowCore for resume', {
      resumeExecutionId,
      triggerType,
      useDraftState: metadata.useDraftState,
      resumeFromSnapshot: metadata.resumeFromSnapshot,
      actorUserId: metadata.userId,
    })

    const workflowId = pausedExecution.workflowId
    const bufferReset = await resetExecutionStreamBuffer(resumeExecutionId)
    if (!bufferReset) {
      throw new Error(RUN_BUFFER_UNAVAILABLE_ERROR)
    }

    const eventWriter = createExecutionEventWriter(resumeExecutionId, {
      workspaceId: metadata.workspaceId,
      workflowId,
      userId: metadata.userId,
      preserveUserFileBase64: true,
    })
    const metaInitialized = await initializeExecutionStreamMeta(resumeExecutionId, {
      userId: metadata.userId,
      workflowId,
    })
    if (!metaInitialized) {
      throw new Error(RUN_BUFFER_UNAVAILABLE_ERROR)
    }

    let terminalEventPublished = false
    let terminalPublishDegraded = false

    /**
     * The run buffer is a replay convenience for stream readers; the durable
     * execution record is authoritative. A failed terminal publish must not
     * decide the outcome of work that already ran — the resume is not
     * retryable at this point, so throwing here would strand the execution as
     * paused and re-run its side effects on the next attempt. Degrade instead:
     * record the terminal status on the stream meta so readers are not left
     * polling an 'active' stream forever, and let the resume settle normally.
     */
    const degradeTerminalPublish = async (
      terminalStatus: TerminalExecutionStreamStatus,
      error: unknown
    ) => {
      terminalPublishDegraded = true
      logger.warn(
        'Failed to publish resume terminal event',
        loggingSession.projectDiagnosticError(error, {
          resumeExecutionId,
          status: terminalStatus,
        })
      )
      const metaPersisted = await markExecutionStreamTerminal(
        resumeExecutionId,
        terminalStatus
      ).catch(() => false)
      if (!metaPersisted) {
        logger.warn('Failed to record degraded terminal status on resume stream meta', {
          resumeExecutionId,
          status: terminalStatus,
        })
      }
    }

    const writeBufferedEvent = async (
      event: ExecutionEvent,
      terminalStatus?: TerminalExecutionStreamStatus
    ) => {
      const isBuffered = !LIVE_ONLY_EXECUTION_EVENT_TYPES.has(event.type)
      if (isBuffered) {
        const entry = terminalStatus
          ? await eventWriter.writeTerminal(event, terminalStatus).catch(async (error) => {
              await degradeTerminalPublish(terminalStatus, error)
              return { eventId: 0, executionId: resumeExecutionId, event }
            })
          : await eventWriter.write(event).catch((error) => {
              // The buffer only backs reconnect replay; the live stream is the
              // primary delivery path. Awaiting this bare let a failed write
              // propagate into the executor callback and fail work that had
              // already run, so degrade the same way the execute route does.
              logger.warn(
                'Resume event buffer write failed; delivering live only',
                loggingSession.projectDiagnosticError(error, {
                  resumeExecutionId,
                  eventType: event.type,
                })
              )
              return null
            })
        // Leave `eventId` unset when the write failed, matching the execute
        // route. Assigning 0 here would be persisted as a reconnect cursor and
        // rewind the client to the start of the run.
        if (entry) event.eventId = entry.eventId
        terminalEventPublished ||= Boolean(terminalStatus)
      }
      sendEvent?.(event)
    }

    await writeBufferedEvent({
      type: 'execution:started',
      timestamp: new Date().toISOString(),
      executionId: resumeExecutionId,
      workflowId,
      data: { startTime: new Date().toISOString() },
    } as ExecutionEvent)

    const callbacks: ExecutionCallbacks = {
      onBlockStart: async (
        blockId: string,
        blockName: string,
        blockType: string,
        executionOrder: number,
        iterationContext?: IterationContext,
        childWorkflowContext?: ChildWorkflowContext
      ) => {
        await writeBufferedEvent({
          type: 'block:started',
          timestamp: new Date().toISOString(),
          executionId: resumeExecutionId,
          workflowId,
          data: {
            blockId,
            blockName,
            blockType,
            executionOrder,
            ...(iterationContext && {
              iterationCurrent: iterationContext.iterationCurrent,
              iterationTotal: iterationContext.iterationTotal,
              iterationType: iterationContext.iterationType,
              iterationContainerId: iterationContext.iterationContainerId,
              ...(iterationContext.parentIterations?.length && {
                parentIterations: iterationContext.parentIterations,
              }),
            }),
            ...(childWorkflowContext && {
              childWorkflowBlockId: childWorkflowContext.parentBlockId,
              childWorkflowName: childWorkflowContext.workflowName,
            }),
          },
        } as ExecutionEvent)
      },
      onBlockComplete: async (
        blockId: string,
        blockName: string,
        blockType: string,
        callbackData: BlockCompletionCallbackData,
        iterationContext?: IterationContext,
        childWorkflowContext?: ChildWorkflowContext
      ) => {
        const output = callbackData.output as Record<string, unknown> | undefined
        const hasError = output?.error
        const display = await loggingSession.projectDisplayContent(
          {
            input: callbackData.input,
            output,
            ...(typeof hasError === 'string' ? { error: hasError } : {}),
          },
          callbackData.displayResolvedSecretTraceProvenance
        )
        const sharedData = {
          blockId,
          blockName,
          blockType,
          input: callbackData.input,
          durationMs: (callbackData.executionTime as number) || 0,
          startedAt: callbackData.startedAt,
          executionOrder: callbackData.executionOrder,
          endedAt: callbackData.endedAt,
          ...(iterationContext && {
            iterationCurrent: iterationContext.iterationCurrent,
            iterationTotal: iterationContext.iterationTotal,
            iterationType: iterationContext.iterationType,
            iterationContainerId: iterationContext.iterationContainerId,
            ...(iterationContext.parentIterations?.length && {
              parentIterations: iterationContext.parentIterations,
            }),
          }),
          ...(childWorkflowContext && {
            childWorkflowBlockId: childWorkflowContext.parentBlockId,
            childWorkflowName: childWorkflowContext.workflowName,
          }),
          ...(callbackData.childWorkflowInstanceId
            ? { childWorkflowInstanceId: callbackData.childWorkflowInstanceId }
            : {}),
        }

        await writeBufferedEvent({
          type: hasError ? 'block:error' : 'block:completed',
          timestamp: new Date().toISOString(),
          executionId: resumeExecutionId,
          workflowId,
          data: hasError
            ? {
                ...sharedData,
                error: output?.error,
                display: {
                  ...(Object.hasOwn(display, 'input') ? { input: display.input } : {}),
                  ...(display.error !== undefined ? { error: display.error } : {}),
                  ...(display.clearLiveDisplay ? { clearLiveDisplay: true as const } : {}),
                },
              }
            : {
                ...sharedData,
                output,
                display: {
                  ...(Object.hasOwn(display, 'input') ? { input: display.input } : {}),
                  ...(Object.hasOwn(display, 'output') ? { output: display.output } : {}),
                  ...(display.clearLiveDisplay ? { clearLiveDisplay: true as const } : {}),
                },
              },
        } as ExecutionEvent)

        if (externalOnBlockComplete) {
          await externalOnBlockComplete(blockId, callbackData)
        }
      },
      onChildWorkflowInstanceReady: async (
        blockId: string,
        childWorkflowInstanceId: string,
        iterationContext?: IterationContext,
        executionOrder?: number
      ) => {
        await writeBufferedEvent({
          type: 'block:childWorkflowStarted',
          timestamp: new Date().toISOString(),
          executionId: resumeExecutionId,
          workflowId,
          data: {
            blockId,
            childWorkflowInstanceId,
            ...(iterationContext && {
              iterationCurrent: iterationContext.iterationCurrent,
              iterationContainerId: iterationContext.iterationContainerId,
            }),
            ...(executionOrder !== undefined && { executionOrder }),
          },
        } as ExecutionEvent)
      },
      onStream: async (streamingExec: StreamingExecution) => {
        if (externalOnStream) {
          await externalOnStream(streamingExec)
          return
        }

        const blockIdValue = isRecordLike(streamingExec.execution)
          ? streamingExec.execution.blockId
          : undefined
        const blockId = typeof blockIdValue === 'string' ? blockIdValue : ''

        // Live answer text rides the sink when available; the byte stream is
        // then drained without re-emitting chunks (same final-turn content).
        const answerTextFromSink = shouldForwardAnswerTextFromSink(streamingExec)

        const unsubscribe = forwardAgentStreamToExecutionEvents(streamingExec, {
          blockId,
          executionId: resumeExecutionId,
          workflowId,
          sendEvent: writeBufferedEvent,
          forwardAnswerText: answerTextFromSink,
          projectDisplay: (field, value) =>
            loggingSession.projectLiveDisplayText(
              field,
              value,
              streamingExec.displayResolvedSecretTraceProvenance
            ),
        })

        const reader = streamingExec.stream.getReader()
        const decoder = new TextDecoder()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (answerTextFromSink) continue
            const chunk = decoder.decode(value, { stream: true })
            const display = await loggingSession.projectLiveDisplayText(
              'chunk',
              chunk,
              streamingExec.displayResolvedSecretTraceProvenance
            )
            await writeBufferedEvent({
              type: 'stream:chunk',
              timestamp: new Date().toISOString(),
              executionId: resumeExecutionId,
              workflowId,
              data: { blockId, chunk, display },
            } as ExecutionEvent)
          }
          await writeBufferedEvent({
            type: 'stream:done',
            timestamp: new Date().toISOString(),
            executionId: resumeExecutionId,
            workflowId,
            data: { blockId },
          } as ExecutionEvent)
        } catch (streamError) {
          logger.error(
            'Error streaming block content during resume',
            loggingSession.projectDiagnosticError(streamError, {
              resumeExecutionId,
              blockId,
            })
          )
        } finally {
          unsubscribe()
          try {
            await reader.cancel().catch(() => {})
          } catch {}
        }
      },
    }

    const timeoutController = createTimeoutAbortController(
      preprocessingResult.executionTimeout.async,
      externalAbortSignal
    )

    let result: ExecutionResult | undefined
    let finalMetaStatus: TerminalExecutionStreamStatus = 'complete'
    let executionError: unknown
    try {
      result = await executeWorkflowCore({
        snapshot: resumeSnapshot,
        callbacks,
        loggingSession,
        skipLogCreation: true,
        includeFileBase64: true,
        base64MaxBytes: undefined,
        abortSignal: timeoutController.signal,
        ...(resumeDeploymentVersionId ? { resumeDeploymentVersionId } : {}),
      })

      if (resumeSnapshot.metadata.resumeTerminalNoop === true && result.status !== 'cancelled') {
        result = {
          ...result,
          output: terminalResumeOutput ?? result.output,
        }
      }

      const displayResultLogs = await loggingSession.projectBlockLogsForDisplay(result.logs ?? [])
      const compactResultLogs = await compactBlockLogs(displayResultLogs, {
        workspaceId: baseSnapshot.metadata.workspaceId,
        workflowId,
        executionId: resumeExecutionId,
        userId: metadata.userId,
        requireDurable: true,
      })
      const compactResultOutput = await compactExecutionPayload(result.output, {
        workspaceId: baseSnapshot.metadata.workspaceId,
        workflowId,
        executionId: resumeExecutionId,
        userId: metadata.userId,
        preserveUserFileBase64: true,
        preserveRoot: true,
        requireDurable: true,
      })

      if (
        result.status === 'cancelled' &&
        timeoutController.isTimedOut() &&
        timeoutController.timeoutMs
      ) {
        const timeoutErrorMessage = getTimeoutErrorMessage(null, timeoutController.timeoutMs)
        logger.info('Resume execution timed out', {
          resumeExecutionId,
          timeoutMs: timeoutController.timeoutMs,
        })
        await loggingSession.markAsFailed(timeoutErrorMessage)
        const timeoutDisplay = await loggingSession.projectDisplayContent({
          error: timeoutErrorMessage,
        })

        finalMetaStatus = 'error'
        await writeBufferedEvent(
          {
            type: 'execution:error',
            timestamp: new Date().toISOString(),
            executionId: resumeExecutionId,
            workflowId,
            data: {
              error: timeoutErrorMessage,
              display: {
                ...(timeoutDisplay.error !== undefined ? { error: timeoutDisplay.error } : {}),
              },
              duration: result.metadata?.duration || 0,
              finalBlockLogs: compactResultLogs,
            },
          },
          'error'
        )
      } else if (result.status === 'cancelled') {
        finalMetaStatus = 'cancelled'
        await writeBufferedEvent(
          {
            type: 'execution:cancelled',
            timestamp: new Date().toISOString(),
            executionId: resumeExecutionId,
            workflowId,
            data: {
              duration: result.metadata?.duration || 0,
              finalBlockLogs: compactResultLogs,
            },
          },
          'cancelled'
        )
      } else if (result.status === 'paused') {
        finalMetaStatus = 'complete'
        await writeBufferedEvent(
          {
            type: 'execution:paused',
            timestamp: new Date().toISOString(),
            executionId: resumeExecutionId,
            workflowId,
            data: {
              output: compactResultOutput,
              duration: result.metadata?.duration || 0,
              startTime: result.metadata?.startTime || new Date().toISOString(),
              endTime: result.metadata?.endTime || new Date().toISOString(),
              finalBlockLogs: compactResultLogs,
            },
          },
          'complete'
        )
      } else {
        finalMetaStatus = 'complete'
        await writeBufferedEvent(
          {
            type: 'execution:completed',
            timestamp: new Date().toISOString(),
            executionId: resumeExecutionId,
            workflowId,
            data: {
              success: result.success,
              output: compactResultOutput,
              duration: result.metadata?.duration || 0,
              startTime: result.metadata?.startTime || new Date().toISOString(),
              endTime: result.metadata?.endTime || new Date().toISOString(),
              finalBlockLogs: compactResultLogs,
            },
          },
          'complete'
        )
      }
    } catch (execError) {
      executionError = execError
      const execErrorResult = hasExecutionResult(execError) ? execError.executionResult : undefined
      let compactErrorLogs: BlockLog[] | undefined
      try {
        compactErrorLogs = execErrorResult?.logs
          ? await compactBlockLogs(
              await loggingSession.projectBlockLogsForDisplay(execErrorResult.logs),
              {
                workspaceId: baseSnapshot.metadata.workspaceId,
                workflowId,
                executionId: resumeExecutionId,
                userId: metadata.userId,
                requireDurable: true,
              }
            )
          : undefined
      } catch (compactionError) {
        logger.warn(
          'Failed to compact resume error logs, omitting oversized error details',
          loggingSession.projectDiagnosticError(compactionError, { resumeExecutionId })
        )
      }
      finalMetaStatus = 'error'
      const terminalError = toError(execError).message
      const terminalDisplay = await loggingSession.projectDisplayContent({ error: terminalError })
      await writeBufferedEvent(
        {
          type: 'execution:error',
          timestamp: new Date().toISOString(),
          executionId: resumeExecutionId,
          workflowId,
          data: {
            error: terminalError,
            display: {
              ...(terminalDisplay.error !== undefined ? { error: terminalDisplay.error } : {}),
            },
            duration: 0,
            finalBlockLogs: compactErrorLogs,
          },
        },
        'error'
      )
    } finally {
      timeoutController.cleanup()
      if (!terminalEventPublished) {
        const replayBufferFlushed = await flushExecutionStreamReplayBuffer(
          resumeExecutionId,
          eventWriter
        )
        logger.warn('Failed to publish resume terminal event durably', {
          resumeExecutionId,
          status: finalMetaStatus,
          replayBufferFlushed,
        })
        await degradeTerminalPublish(
          finalMetaStatus,
          new Error('Terminal event was never published')
        )
      } else {
        await eventWriter.close().catch((error) => {
          logger.warn(
            'Failed to close resume event writer after terminal publish',
            loggingSession.projectDiagnosticError(error, { resumeExecutionId })
          )
        })
      }
      void cleanupExecutionBase64Cache(resumeExecutionId)
    }

    /**
     * The durable queue entry is also the reservation identity. Settle the
     * attempt's logging finalizer before the queue can retry that same entry or
     * claim the next one, so an older release cannot race a renewed reservation.
     */
    await loggingSession.waitForPostExecution()

    if (terminalPublishDegraded) {
      logger.warn('Resume settled with a degraded run buffer', {
        resumeExecutionId,
        status: finalMetaStatus,
      })
    }

    if (executionError || !result) {
      throw executionError ?? new Error('Resume execution did not produce a result')
    }

    return result
  }

  private static async markResumeCompleted(args: {
    resumeEntryId: string
    pausedExecutionId?: string
    parentExecutionId?: string
    contextId?: string
  }): Promise<void> {
    const { resumeEntryId, pausedExecutionId, parentExecutionId, contextId } = args
    const now = new Date()

    let targetPausedExecutionId = pausedExecutionId
    let targetParentExecutionId = parentExecutionId
    if (!targetPausedExecutionId || !targetParentExecutionId) {
      const resumeIdentity = await execDb
        .select({
          parentExecutionId: resumeQueue.parentExecutionId,
          pausedExecutionId: resumeQueue.pausedExecutionId,
        })
        .from(resumeQueue)
        .where(eq(resumeQueue.id, resumeEntryId))
        .limit(1)
        .then((rows) => rows[0])
      if (!resumeIdentity) return
      targetPausedExecutionId = resumeIdentity.pausedExecutionId
      targetParentExecutionId = resumeIdentity.parentExecutionId
    }

    await execDb.transaction(async (tx) => {
      const executionLog = await tx
        .select({ status: workflowExecutionLogs.status })
        .from(workflowExecutionLogs)
        .where(eq(workflowExecutionLogs.executionId, targetParentExecutionId))
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      const pausedExecution = await tx
        .select({ status: pausedExecutions.status })
        .from(pausedExecutions)
        .where(eq(pausedExecutions.id, targetPausedExecutionId))
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      const resumeEntry = await tx
        .select({ status: resumeQueue.status })
        .from(resumeQueue)
        .where(eq(resumeQueue.id, resumeEntryId))
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      const cancellationWon =
        executionLog?.status === 'cancelled' ||
        pausedExecution?.status === 'cancelling' ||
        pausedExecution?.status === 'cancelled'
      if (cancellationWon) {
        if (resumeEntry?.status === 'claimed') {
          await tx
            .update(resumeQueue)
            .set({
              status: 'failed',
              completedAt: now,
              failureReason: 'Paused execution cancelled',
            })
            .where(and(eq(resumeQueue.id, resumeEntryId), eq(resumeQueue.status, 'claimed')))
        }
        if (
          executionLog?.status === 'cancelled' &&
          pausedExecution &&
          pausedExecution.status !== 'cancelled'
        ) {
          await tx
            .update(pausedExecutions)
            .set({ status: 'cancelled', updatedAt: now, nextResumeAt: null })
            .where(eq(pausedExecutions.id, targetPausedExecutionId))
        }
        return
      }

      if (resumeEntry?.status !== 'claimed') return

      await tx
        .update(resumeQueue)
        .set({ status: 'completed', completedAt: now, failureReason: null })
        .where(and(eq(resumeQueue.id, resumeEntryId), eq(resumeQueue.status, 'claimed')))

      if (!pausedExecution || !contextId) return

      await tx
        .update(pausedExecutions)
        .set({
          pausePoints: sql`jsonb_set(
            ${updatePausePointResumeStateSql(contextId, 'resumed')},
            ARRAY[${contextId}, 'resumedAt'],
            ${JSON.stringify(now.toISOString())}::jsonb
          )`,
          metadata: clearAutomaticResumeWaitingMetadataSql(contextId),
          resumedCount: sql`resumed_count + 1`,
          automaticResumeRetryCount: 0,
          status: sql`CASE WHEN status IN ('cancelling', 'cancelled') THEN status WHEN resumed_count + 1 >= total_pause_count THEN 'fully_resumed' ELSE 'partially_resumed' END`,
          updatedAt: now,
        })
        .where(eq(pausedExecutions.id, targetPausedExecutionId))

      const [{ remaining }] = await tx
        .select({ remaining: sql<number>`total_pause_count - resumed_count` })
        .from(pausedExecutions)
        .where(eq(pausedExecutions.executionId, targetParentExecutionId))

      if (Number(remaining) <= 0) {
        await tx
          .update(pausedExecutions)
          .set({
            status: sql`CASE WHEN status IN ('cancelling', 'cancelled') THEN status ELSE 'fully_resumed' END`,
            updatedAt: now,
          })
          .where(eq(pausedExecutions.executionId, targetParentExecutionId))
      } else {
        await tx
          .update(workflowExecutionLogs)
          .set({ status: 'pending', executionDeadlineAt: null, ...revivedExecutionLogStamp })
          .where(
            and(
              eq(workflowExecutionLogs.executionId, targetParentExecutionId),
              sql`${workflowExecutionLogs.status} != 'cancelled'`,
              sql`NOT EXISTS (
                SELECT 1 FROM ${pausedExecutions}
                WHERE ${pausedExecutions.executionId} = ${targetParentExecutionId}
                  AND ${pausedExecutions.status} = 'cancelling'
              )`
            )
          )
      }
    })
  }

  private static async markResumeFailed(args: {
    resumeEntryId: string
    pausedExecutionId: string
    parentExecutionId: string
    contextId: string
    failureReason: string
  }): Promise<void> {
    const now = new Date()

    await execDb.transaction(async (tx) => {
      const executionLog = await tx
        .select({ status: workflowExecutionLogs.status })
        .from(workflowExecutionLogs)
        .where(eq(workflowExecutionLogs.executionId, args.parentExecutionId))
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      const pausedExecution = await tx
        .select({ status: pausedExecutions.status })
        .from(pausedExecutions)
        .where(eq(pausedExecutions.id, args.pausedExecutionId))
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      await tx
        .update(resumeQueue)
        .set({ status: 'failed', failureReason: args.failureReason, completedAt: now })
        .where(eq(resumeQueue.id, args.resumeEntryId))

      if (executionLog?.status === 'cancelled' || pausedExecution?.status === 'cancelled') {
        if (pausedExecution && pausedExecution.status !== 'cancelled') {
          await tx
            .update(pausedExecutions)
            .set({ status: 'cancelled', updatedAt: now, nextResumeAt: null })
            .where(eq(pausedExecutions.id, args.pausedExecutionId))
        }
        return
      }

      await tx
        .update(pausedExecutions)
        .set({
          pausePoints: updatePausePointResumeStateSql(args.contextId, 'failed'),
          metadata: clearAutomaticResumeWaitingMetadataSql(args.contextId),
        })
        .where(eq(pausedExecutions.id, args.pausedExecutionId))

      if (pausedExecution?.status === 'cancelling') return

      await tx
        .update(workflowExecutionLogs)
        .set(terminalExecutionLogFields('failed', now))
        .where(
          and(
            eq(workflowExecutionLogs.executionId, args.parentExecutionId),
            sql`${workflowExecutionLogs.status} != 'cancelled'`
          )
        )
    })
  }

  static async markResumeAttemptFailed(args: {
    resumeEntryId: string
    pausedExecutionId: string
    parentExecutionId: string
    contextId: string
    failureReason: string
    preserveForRetry?: boolean
    retryable?: boolean
  }): Promise<void> {
    const now = new Date()

    await execDb.transaction(async (tx) => {
      const executionLog = await tx
        .select({ status: workflowExecutionLogs.status })
        .from(workflowExecutionLogs)
        .where(eq(workflowExecutionLogs.executionId, args.parentExecutionId))
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      const pausedExecution = await tx
        .select({
          automaticResumeRetryCount: pausedExecutions.automaticResumeRetryCount,
          status: pausedExecutions.status,
        })
        .from(pausedExecutions)
        .where(eq(pausedExecutions.id, args.pausedExecutionId))
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      const admissionDecision =
        args.preserveForRetry &&
        pausedExecution &&
        isResumablePausedStatus(pausedExecution.status) &&
        executionLog?.status !== 'cancelled'
          ? resolveAutomaticResumeAdmissionFailure({
              currentRetryCount: pausedExecution.automaticResumeRetryCount,
              retryable: args.retryable === true,
              now,
            })
          : undefined
      const canRetry = admissionDecision?.state === 'waiting'
      const automaticResumeWaitingReason = admissionDecision
        ? getAutomaticResumeAdmissionReason(args.failureReason, admissionDecision.state)
        : undefined

      await tx
        .update(resumeQueue)
        .set(
          canRetry
            ? {
                status: 'pending',
                failureReason: args.failureReason,
                claimedAt: null,
                completedAt: null,
              }
            : { status: 'failed', failureReason: args.failureReason, completedAt: now }
        )
        .where(eq(resumeQueue.id, args.resumeEntryId))

      if (executionLog?.status === 'cancelled' || pausedExecution?.status === 'cancelled') {
        if (pausedExecution && pausedExecution.status !== 'cancelled') {
          await tx
            .update(pausedExecutions)
            .set({ status: 'cancelled', updatedAt: now, nextResumeAt: null })
            .where(eq(pausedExecutions.id, args.pausedExecutionId))
        }
        return
      }

      await tx
        .update(pausedExecutions)
        .set({
          pausePoints: updatePausePointResumeStateSql(
            args.contextId,
            canRetry ? 'queued' : 'paused',
            automaticResumeWaitingReason
          ),
          metadata: automaticResumeWaitingReason
            ? setAutomaticResumeWaitingMetadataSql({
                contextId: args.contextId,
                reason: automaticResumeWaitingReason,
                recordedAt: now.toISOString(),
                state: admissionDecision!.state,
                retryCount: admissionDecision!.retryCount,
              })
            : clearAutomaticResumeWaitingMetadataSql(args.contextId),
          status: sql`CASE WHEN status = 'cancelling' THEN 'cancelling' ELSE status END`,
          updatedAt: now,
          ...(admissionDecision
            ? {
                automaticResumeRetryCount: admissionDecision.retryCount,
                nextResumeAt: admissionDecision.retryAt,
              }
            : {}),
        })
        .where(eq(pausedExecutions.id, args.pausedExecutionId))

      if (pausedExecution?.status === 'cancelling') return

      await tx
        .update(workflowExecutionLogs)
        .set({
          status: sql`CASE
            WHEN status IN ('cancelled', 'failed', 'completed') THEN status
            ELSE 'paused'
          END`,
          executionDeadlineAt: null,
        })
        .where(
          and(
            eq(workflowExecutionLogs.executionId, args.parentExecutionId),
            sql`NOT EXISTS (
              SELECT 1 FROM ${pausedExecutions}
              WHERE ${pausedExecutions.id} = ${args.pausedExecutionId}
                AND ${pausedExecutions.status} = 'cancelling'
            )`
          )
        )
    })
  }

  private static async updateSnapshotAfterResume(args: {
    pausedExecutionId: string
    contextId: string
    pauseBlockId: string
    executionState?: SerializableExecutionState
  }): Promise<void> {
    const { pausedExecutionId, contextId, pauseBlockId, executionState } = args

    const pausedExecution = await execDb
      .select()
      .from(pausedExecutions)
      .where(eq(pausedExecutions.id, pausedExecutionId))
      .limit(1)
      .then((rows) => rows[0])

    if (!pausedExecution) {
      logger.error('Paused execution not found when updating snapshot', { pausedExecutionId })
      return
    }

    const currentSnapshot = pausedExecution.executionSnapshot as SerializedSnapshot
    const snapshotData = JSON.parse(currentSnapshot.snapshot)
    if (executionState) {
      snapshotData.state = executionState
    }

    if (snapshotData.state) {
      const completedPauseContexts = new Set<string>(
        (snapshotData.state.completedPauseContexts ?? []).map((id: string) =>
          PauseResumeManager.normalizePauseBlockId(id)
        )
      )
      completedPauseContexts.add(pauseBlockId)
      snapshotData.state.completedPauseContexts = Array.from(completedPauseContexts)

      const dagIncomingEdges = snapshotData.state.dagIncomingEdges

      if (dagIncomingEdges) {
        const workflowData = snapshotData.workflow
        const connections = workflowData.connections || []

        for (const conn of connections) {
          if (conn.source === pauseBlockId) {
            const targetId = conn.target
            if (dagIncomingEdges[targetId]) {
              dagIncomingEdges[targetId] = dagIncomingEdges[targetId].filter(
                (sourceId: string) => sourceId !== pauseBlockId
              )

              logger.debug('Updated DAG incoming edges in snapshot', {
                removedSource: pauseBlockId,
                target: targetId,
                remainingIncoming: dagIncomingEdges[targetId].length,
              })
            }
          }
        }
      }
    }

    const updatedSnapshot: SerializedSnapshot = {
      snapshot: JSON.stringify(snapshotData),
      triggerIds: currentSnapshot.triggerIds,
    }
    const snapshotWorkspaceId = getSnapshotWorkspaceId(snapshotData)
    const snapshotReferenceValue = { ...updatedSnapshot, snapshot: snapshotData }
    const snapshotReferenceKeys = snapshotWorkspaceId
      ? collectLargeValueReferenceKeys(snapshotReferenceValue, snapshotWorkspaceId)
      : []

    await execDb.transaction(async (tx) => {
      await tx
        .update(pausedExecutions)
        .set({
          executionSnapshot: updatedSnapshot,
          updatedAt: new Date(),
        })
        .where(eq(pausedExecutions.id, pausedExecutionId))

      if (snapshotWorkspaceId) {
        await replaceLargeValueReferenceKeysWithClient(
          tx,
          {
            workspaceId: snapshotWorkspaceId,
            workflowId: pausedExecution.workflowId,
            executionId: pausedExecution.executionId,
            source: 'paused_snapshot',
          },
          snapshotReferenceKeys
        )
      }
    })

    logger.info('Updated snapshot after resume', {
      pausedExecutionId,
      contextId,
    })
  }

  static async beginPausedCancellation(executionId: string, workflowId: string): Promise<boolean> {
    const now = new Date()

    return await execDb.transaction(async (tx) => {
      const pausedExecution = await tx
        .select({ id: pausedExecutions.id, status: pausedExecutions.status })
        .from(pausedExecutions)
        .where(
          and(
            eq(pausedExecutions.executionId, executionId),
            eq(pausedExecutions.workflowId, workflowId),
            inArray(pausedExecutions.status, [...CANCELLABLE_PAUSED_STATUSES, 'cancelling'])
          )
        )
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      if (!pausedExecution) {
        return false
      }

      const activeResume = await tx
        .select({ id: resumeQueue.id })
        .from(resumeQueue)
        .where(
          and(eq(resumeQueue.parentExecutionId, executionId), eq(resumeQueue.status, 'claimed'))
        )
        .limit(1)
        .then((rows) => rows[0])

      if (activeResume) {
        if (pausedExecution.status !== 'cancelling') {
          await tx
            .update(pausedExecutions)
            .set({ status: 'cancelling', updatedAt: now })
            .where(eq(pausedExecutions.id, pausedExecution.id))
        }
        return false
      }

      if (pausedExecution.status !== 'cancelling') {
        await tx
          .update(pausedExecutions)
          .set({ status: 'cancelling', updatedAt: now })
          .where(eq(pausedExecutions.id, pausedExecution.id))
      }

      return true
    })
  }

  /**
   * Stages cancellation and identifies the exact claimed resume while holding
   * the workflow log, pause, and resume queue locks in canonical order.
   * Resume admission locks the same pause row and rejects `cancelling`, so a
   * replacement cannot be claimed after this transaction commits.
   */
  static async stagePausedCancellation(
    executionId: string,
    workflowId: string
  ): Promise<PausedCancellationStage> {
    const now = new Date()

    return await execDb.transaction(async (tx) => {
      const executionLog = await tx
        .select({ status: workflowExecutionLogs.status })
        .from(workflowExecutionLogs)
        .where(
          and(
            eq(workflowExecutionLogs.executionId, executionId),
            eq(workflowExecutionLogs.workflowId, workflowId)
          )
        )
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      if (
        !executionLog ||
        (executionLog.status !== 'running' &&
          executionLog.status !== 'pending' &&
          executionLog.status !== 'cancelled')
      ) {
        return { kind: 'not_paused' }
      }

      const pausedExecution = await tx
        .select({ id: pausedExecutions.id, status: pausedExecutions.status })
        .from(pausedExecutions)
        .where(
          and(
            eq(pausedExecutions.executionId, executionId),
            eq(pausedExecutions.workflowId, workflowId),
            inArray(pausedExecutions.status, [...CANCELLABLE_PAUSED_STATUSES, 'cancelling'])
          )
        )
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      if (!pausedExecution) {
        return { kind: 'not_paused' }
      }

      const activeResume = await tx
        .select({
          resumeEntryId: resumeQueue.id,
          pausedExecutionId: resumeQueue.pausedExecutionId,
          parentExecutionId: resumeQueue.parentExecutionId,
          resumeExecutionId: resumeQueue.newExecutionId,
        })
        .from(resumeQueue)
        .where(
          and(
            eq(resumeQueue.parentExecutionId, executionId),
            eq(resumeQueue.pausedExecutionId, pausedExecution.id),
            eq(resumeQueue.status, 'claimed')
          )
        )
        .orderBy(desc(resumeQueue.claimedAt))
        .limit(1)
        .for('update')
        .then((rows) => rows[0])

      if (pausedExecution.status !== 'cancelling') {
        await tx
          .update(pausedExecutions)
          .set({ status: 'cancelling', updatedAt: now })
          .where(
            and(
              eq(pausedExecutions.id, pausedExecution.id),
              inArray(pausedExecutions.status, CANCELLABLE_PAUSED_STATUSES)
            )
          )
      }

      await tx
        .update(resumeQueue)
        .set({
          status: 'failed',
          completedAt: now,
          failureReason: PAUSED_CANCELLATION_QUEUE_FAILURE_REASON,
        })
        .where(
          and(
            eq(resumeQueue.parentExecutionId, executionId),
            eq(resumeQueue.pausedExecutionId, pausedExecution.id),
            eq(resumeQueue.status, 'pending')
          )
        )

      if (!activeResume) {
        return { kind: 'idle' }
      }

      return { kind: 'active_resume', target: activeResume }
    })
  }

  static async completePausedCancellation(
    executionId: string,
    workflowId: string
  ): Promise<boolean> {
    const now = new Date()

    const transition = await execDb.transaction(async (tx) => {
      const executionLog = await tx
        .select({ status: workflowExecutionLogs.status })
        .from(workflowExecutionLogs)
        .where(
          and(
            eq(workflowExecutionLogs.executionId, executionId),
            eq(workflowExecutionLogs.workflowId, workflowId)
          )
        )
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      const pausedExecution = await tx
        .select({ id: pausedExecutions.id, status: pausedExecutions.status })
        .from(pausedExecutions)
        .where(
          and(
            eq(pausedExecutions.executionId, executionId),
            eq(pausedExecutions.workflowId, workflowId)
          )
        )
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      if (!executionLog || !pausedExecution) {
        return { cancelled: false, claimedResumeEntryIds: [] as string[] }
      }

      const cancellationAlreadyTerminal = executionLog.status === 'cancelled'
      const cancellationWasStaged =
        pausedExecution.status === 'cancelling' || pausedExecution.status === 'cancelled'
      if (
        !cancellationAlreadyTerminal &&
        (!cancellationWasStaged ||
          (executionLog.status !== 'running' && executionLog.status !== 'pending'))
      ) {
        return { cancelled: false, claimedResumeEntryIds: [] as string[] }
      }

      if (!cancellationAlreadyTerminal) {
        const [cancelledExecution] = await tx
          .update(workflowExecutionLogs)
          .set(cancelledExecutionLogFields(now))
          .where(
            and(
              eq(workflowExecutionLogs.executionId, executionId),
              eq(workflowExecutionLogs.workflowId, workflowId),
              inArray(workflowExecutionLogs.status, ['running', 'pending', 'cancelled'])
            )
          )
          .returning({ status: workflowExecutionLogs.status })

        if (cancelledExecution?.status !== 'cancelled') {
          return { cancelled: false, claimedResumeEntryIds: [] as string[] }
        }
      }

      if (pausedExecution.status !== 'cancelled') {
        await tx
          .update(pausedExecutions)
          .set({ status: 'cancelled', updatedAt: now, nextResumeAt: null })
          .where(eq(pausedExecutions.id, pausedExecution.id))
      }

      const claimedResumeEntries = await tx
        .select({ id: resumeQueue.id })
        .from(resumeQueue)
        .where(
          and(eq(resumeQueue.parentExecutionId, executionId), eq(resumeQueue.status, 'claimed'))
        )
        .for('update')

      await tx
        .update(resumeQueue)
        .set({
          status: 'failed',
          completedAt: now,
          failureReason: 'Paused execution cancelled',
        })
        .where(
          and(
            eq(resumeQueue.parentExecutionId, executionId),
            inArray(resumeQueue.status, ['pending', 'claimed'])
          )
        )

      return {
        cancelled: true,
        claimedResumeEntryIds: claimedResumeEntries.map((entry) => entry.id),
      }
    })

    await releaseCancelledResumeReservations(transition.claimedResumeEntryIds)
    return transition.cancelled
  }

  /**
   * Finalizes only pause and resume state when a non-cancellation terminal
   * transition wins the parent execution race. The parent log is locked and
   * inspected but never mutated, so a late claimed resume cannot revive it.
   * Every claimed resume must be stopped before its queue row is finalized.
   */
  static async finalizePausedCancellationForTerminalRun(
    executionId: string,
    workflowId: string,
    stoppedResumeEntryIds: string[]
  ): Promise<boolean> {
    const now = new Date()

    const transition = await execDb.transaction(async (tx) => {
      const executionLog = await tx
        .select({ status: workflowExecutionLogs.status })
        .from(workflowExecutionLogs)
        .where(
          and(
            eq(workflowExecutionLogs.executionId, executionId),
            eq(workflowExecutionLogs.workflowId, workflowId)
          )
        )
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      if (executionLog?.status === 'running' || executionLog?.status === 'pending') {
        return { finalized: false, claimedResumeEntryIds: [] as string[] }
      }

      const pausedExecution = await tx
        .select({ id: pausedExecutions.id, status: pausedExecutions.status })
        .from(pausedExecutions)
        .where(
          and(
            eq(pausedExecutions.executionId, executionId),
            eq(pausedExecutions.workflowId, workflowId),
            inArray(pausedExecutions.status, ['cancelling', 'cancelled'])
          )
        )
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      if (!pausedExecution) {
        return { finalized: true, claimedResumeEntryIds: [] as string[] }
      }

      const claimedResumeEntries = await tx
        .select({ id: resumeQueue.id })
        .from(resumeQueue)
        .where(
          and(
            eq(resumeQueue.parentExecutionId, executionId),
            eq(resumeQueue.pausedExecutionId, pausedExecution.id),
            eq(resumeQueue.status, 'claimed')
          )
        )
        .for('update')

      const stoppedResumeEntryIdSet = new Set(stoppedResumeEntryIds)
      if (claimedResumeEntries.some((entry) => !stoppedResumeEntryIdSet.has(entry.id))) {
        return { finalized: false, claimedResumeEntryIds: [] as string[] }
      }

      if (pausedExecution.status !== 'cancelled') {
        await tx
          .update(pausedExecutions)
          .set({ status: 'cancelled', updatedAt: now, nextResumeAt: null })
          .where(
            and(
              eq(pausedExecutions.id, pausedExecution.id),
              eq(pausedExecutions.status, 'cancelling')
            )
          )
      }

      await tx
        .update(resumeQueue)
        .set({
          status: 'failed',
          completedAt: now,
          failureReason: 'Paused execution cancelled',
        })
        .where(
          and(
            eq(resumeQueue.parentExecutionId, executionId),
            eq(resumeQueue.pausedExecutionId, pausedExecution.id),
            inArray(resumeQueue.status, ['pending', 'claimed'])
          )
        )

      return {
        finalized: true,
        claimedResumeEntryIds: claimedResumeEntries.map((entry) => entry.id),
      }
    })

    await releaseCancelledResumeReservations(transition.claimedResumeEntryIds)
    return transition.finalized
  }

  static async blockQueuedResumesForCancellation(
    executionId: string,
    workflowId: string
  ): Promise<boolean> {
    const now = new Date()

    return await execDb.transaction(async (tx) => {
      const pausedExecution = await tx
        .select({ id: pausedExecutions.id })
        .from(pausedExecutions)
        .where(
          and(
            eq(pausedExecutions.executionId, executionId),
            eq(pausedExecutions.workflowId, workflowId),
            inArray(pausedExecutions.status, [...CANCELLABLE_PAUSED_STATUSES, 'cancelling'])
          )
        )
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      if (!pausedExecution) {
        return false
      }

      await tx
        .update(pausedExecutions)
        .set({ status: 'cancelling', updatedAt: now })
        .where(eq(pausedExecutions.id, pausedExecution.id))

      await tx
        .update(resumeQueue)
        .set({
          status: 'failed',
          completedAt: now,
          failureReason: PAUSED_CANCELLATION_QUEUE_FAILURE_REASON,
        })
        .where(
          and(eq(resumeQueue.parentExecutionId, executionId), eq(resumeQueue.status, 'pending'))
        )

      const activeResume = await tx
        .select({ id: resumeQueue.id })
        .from(resumeQueue)
        .where(
          and(eq(resumeQueue.parentExecutionId, executionId), eq(resumeQueue.status, 'claimed'))
        )
        .limit(1)
        .then((rows) => rows[0])

      return !activeResume
    })
  }

  static async getActiveResumeCancellationTarget(
    executionId: string,
    workflowId: string
  ): Promise<ActiveResumeCancellationTarget | null> {
    const activeResumes = await PauseResumeManager.getActiveResumeCancellationTargets(
      executionId,
      workflowId
    )
    return activeResumes[0] ?? null
  }

  static async getActiveResumeCancellationTargets(
    executionId: string,
    workflowId: string
  ): Promise<ActiveResumeCancellationTarget[]> {
    return await execDb
      .select({
        resumeEntryId: resumeQueue.id,
        pausedExecutionId: resumeQueue.pausedExecutionId,
        parentExecutionId: resumeQueue.parentExecutionId,
        resumeExecutionId: resumeQueue.newExecutionId,
      })
      .from(resumeQueue)
      .innerJoin(pausedExecutions, eq(resumeQueue.pausedExecutionId, pausedExecutions.id))
      .where(
        and(
          eq(resumeQueue.parentExecutionId, executionId),
          eq(resumeQueue.status, 'claimed'),
          eq(pausedExecutions.executionId, executionId),
          eq(pausedExecutions.workflowId, workflowId)
        )
      )
      .orderBy(desc(resumeQueue.claimedAt))
  }

  static async rollbackActiveResumeCancellation(
    executionId: string,
    workflowId: string,
    resumeEntryId: string
  ): Promise<boolean> {
    const now = new Date()

    const rollback = await execDb.transaction(async (tx) => {
      const executionLog = await tx
        .select({ status: workflowExecutionLogs.status })
        .from(workflowExecutionLogs)
        .where(
          and(
            eq(workflowExecutionLogs.executionId, executionId),
            eq(workflowExecutionLogs.workflowId, workflowId)
          )
        )
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      const pausedExecution = await tx
        .select({
          id: pausedExecutions.id,
          status: pausedExecutions.status,
        })
        .from(pausedExecutions)
        .where(
          and(
            eq(pausedExecutions.executionId, executionId),
            eq(pausedExecutions.workflowId, workflowId)
          )
        )
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      const exactResume = pausedExecution
        ? await tx
            .select({
              contextId: resumeQueue.contextId,
              id: resumeQueue.id,
              parentExecutionId: resumeQueue.parentExecutionId,
              pausedExecutionId: resumeQueue.pausedExecutionId,
              status: resumeQueue.status,
            })
            .from(resumeQueue)
            .where(eq(resumeQueue.id, resumeEntryId))
            .for('update')
            .limit(1)
            .then((rows) => rows[0])
        : undefined

      const claimedResumes = pausedExecution
        ? await tx
            .select({ id: resumeQueue.id })
            .from(resumeQueue)
            .where(
              and(
                eq(resumeQueue.parentExecutionId, executionId),
                eq(resumeQueue.pausedExecutionId, pausedExecution.id),
                eq(resumeQueue.status, 'claimed')
              )
            )
            .for('update')
        : []

      const hasReplacementClaim = claimedResumes.some((entry) => entry.id !== resumeEntryId)

      if (
        !executionLog ||
        (executionLog.status !== 'running' && executionLog.status !== 'pending') ||
        pausedExecution?.status !== 'cancelling' ||
        !exactResume ||
        (exactResume.status !== 'claimed' &&
          exactResume.status !== 'failed' &&
          exactResume.status !== 'completed') ||
        exactResume.parentExecutionId !== executionId ||
        exactResume.pausedExecutionId !== pausedExecution.id ||
        hasReplacementClaim
      ) {
        return { rolledBack: false, shouldProcessQueuedResumes: false }
      }

      await tx
        .update(pausedExecutions)
        .set(
          exactResume.status === 'failed'
            ? {
                pausePoints: updatePausePointResumeStateSql(exactResume.contextId, 'paused'),
                metadata: clearAutomaticResumeWaitingMetadataSql(exactResume.contextId),
                automaticResumeRetryCount: 0,
                nextResumeAt: null,
                status: sql`CASE
                  WHEN resumed_count >= total_pause_count THEN 'fully_resumed'
                  WHEN resumed_count > 0 THEN 'partially_resumed'
                  ELSE 'paused'
                END`,
                updatedAt: now,
              }
            : {
                status: sql`CASE
                  WHEN resumed_count >= total_pause_count THEN 'fully_resumed'
                  WHEN resumed_count > 0 THEN 'partially_resumed'
                  ELSE 'paused'
                END`,
                updatedAt: now,
              }
        )
        .where(
          and(
            eq(pausedExecutions.id, pausedExecution.id),
            eq(pausedExecutions.status, 'cancelling')
          )
        )

      await tx
        .update(resumeQueue)
        .set({ status: 'pending', completedAt: null, failureReason: null })
        .where(
          and(
            eq(resumeQueue.parentExecutionId, executionId),
            eq(resumeQueue.pausedExecutionId, pausedExecution.id),
            eq(resumeQueue.status, 'failed'),
            eq(resumeQueue.failureReason, PAUSED_CANCELLATION_QUEUE_FAILURE_REASON)
          )
        )

      return {
        rolledBack: true,
        shouldProcessQueuedResumes: exactResume.status !== 'claimed',
      }
    })

    if (rollback.shouldProcessQueuedResumes) {
      await PauseResumeManager.processQueuedResumes(executionId, workflowId).catch((error) => {
        logger.warn('Failed to dispatch restored resume queue after cancellation rollback', {
          executionId,
          resumeEntryId,
          error: toError(error).message,
        })
      })
    }

    return rollback.rolledBack
  }

  static async clearPausedCancellationIntent(
    executionId: string,
    workflowId: string
  ): Promise<void> {
    const now = new Date()

    const shouldProcessQueuedResumes = await execDb.transaction(async (tx) => {
      const executionLog = await tx
        .select({ status: workflowExecutionLogs.status })
        .from(workflowExecutionLogs)
        .where(
          and(
            eq(workflowExecutionLogs.executionId, executionId),
            eq(workflowExecutionLogs.workflowId, workflowId)
          )
        )
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      const pausedExecution = await tx
        .select({ id: pausedExecutions.id })
        .from(pausedExecutions)
        .where(
          and(
            eq(pausedExecutions.executionId, executionId),
            eq(pausedExecutions.workflowId, workflowId),
            eq(pausedExecutions.status, 'cancelling')
          )
        )
        .for('update')
        .limit(1)
        .then((rows) => rows[0])

      if (!pausedExecution) {
        return false
      }

      const workflowIsActive =
        executionLog?.status === 'running' || executionLog?.status === 'pending'

      await tx
        .update(pausedExecutions)
        .set({
          status: sql`CASE
            WHEN resumed_count >= total_pause_count THEN 'fully_resumed'
            WHEN resumed_count > 0 THEN 'partially_resumed'
            ELSE 'paused'
          END`,
          updatedAt: now,
        })
        .where(
          and(
            eq(pausedExecutions.id, pausedExecution.id),
            eq(pausedExecutions.status, 'cancelling')
          )
        )

      if (!workflowIsActive) {
        return false
      }

      await tx
        .update(resumeQueue)
        .set({ status: 'pending', completedAt: null, failureReason: null })
        .where(
          and(
            eq(resumeQueue.parentExecutionId, executionId),
            eq(resumeQueue.pausedExecutionId, pausedExecution.id),
            eq(resumeQueue.status, 'failed'),
            eq(resumeQueue.failureReason, PAUSED_CANCELLATION_QUEUE_FAILURE_REASON)
          )
        )

      return true
    })

    if (shouldProcessQueuedResumes) {
      await PauseResumeManager.processQueuedResumes(executionId, workflowId)
    }
  }

  static async getPausedCancellationStatus(
    executionId: string,
    workflowId: string
  ): Promise<'active_resume' | 'cancelling' | 'cancelled' | null> {
    const activeResume = await execDb
      .select({ id: resumeQueue.id })
      .from(resumeQueue)
      .where(and(eq(resumeQueue.parentExecutionId, executionId), eq(resumeQueue.status, 'claimed')))
      .limit(1)
      .then((rows) => rows[0])

    if (activeResume) {
      return 'active_resume'
    }

    const pausedExecution = await execDb
      .select({ status: pausedExecutions.status })
      .from(pausedExecutions)
      .where(
        and(
          eq(pausedExecutions.executionId, executionId),
          eq(pausedExecutions.workflowId, workflowId)
        )
      )
      .limit(1)
      .then((rows) => rows[0])

    if (pausedExecution?.status === 'cancelling' || pausedExecution?.status === 'cancelled') {
      return pausedExecution.status
    }
    return null
  }

  static async setAutomaticResumeWaiting(args: {
    pausedExecutionId: string
    contextId: string
    reason: string
    retryAt?: Date | null
    retryable: boolean
  }): Promise<void> {
    const now = new Date()

    await execDb.transaction(async (tx) => {
      const pausedExecution = await tx
        .select({
          automaticResumeRetryCount: pausedExecutions.automaticResumeRetryCount,
          status: pausedExecutions.status,
        })
        .from(pausedExecutions)
        .where(eq(pausedExecutions.id, args.pausedExecutionId))
        .for('update')
        .limit(1)
        .then((rows) => rows[0])
      if (!pausedExecution || !isResumablePausedStatus(pausedExecution.status)) {
        return
      }

      const decision = resolveAutomaticResumeAdmissionFailure({
        currentRetryCount: pausedExecution.automaticResumeRetryCount,
        retryable: args.retryable,
        now,
        ...(args.retryAt ? { retryAt: args.retryAt } : {}),
      })
      const reason = getAutomaticResumeAdmissionReason(args.reason, decision.state)
      const activeResume =
        decision.state === 'intervention_required'
          ? await tx
              .select({ id: resumeQueue.id })
              .from(resumeQueue)
              .where(
                and(
                  eq(resumeQueue.pausedExecutionId, args.pausedExecutionId),
                  eq(resumeQueue.contextId, args.contextId),
                  eq(resumeQueue.status, 'claimed')
                )
              )
              .limit(1)
              .then((rows) => rows[0])
          : undefined

      if (decision.state === 'intervention_required') {
        await tx
          .update(resumeQueue)
          .set({
            status: 'failed',
            failureReason: reason,
            completedAt: now,
          })
          .where(
            and(
              eq(resumeQueue.pausedExecutionId, args.pausedExecutionId),
              eq(resumeQueue.contextId, args.contextId),
              eq(resumeQueue.status, 'pending')
            )
          )
      }

      await tx
        .update(pausedExecutions)
        .set({
          pausePoints:
            decision.state === 'intervention_required' && !activeResume
              ? updatePausePointResumeStateSql(args.contextId, 'paused', reason)
              : setPausePointAutomaticResumeWaitingReasonSql(args.contextId, reason),
          metadata: setAutomaticResumeWaitingMetadataSql({
            contextId: args.contextId,
            reason,
            recordedAt: now.toISOString(),
            state: decision.state,
            retryCount: decision.retryCount,
          }),
          automaticResumeRetryCount: decision.retryCount,
          nextResumeAt: decision.retryAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(pausedExecutions.id, args.pausedExecutionId),
            inArray(pausedExecutions.status, ['paused', 'partially_resumed'])
          )
        )
    })
  }

  /**
   * Updates `next_resume_at` only when the row is still in a poll-eligible state.
   * Guard prevents the cron poller from clobbering a freshly-written value when a
   * concurrent manual resume has already advanced the row's state. `partially_resumed`
   * rows must also be writable so the cron poller can null out their `nextResumeAt`
   * after dispatch; otherwise the row keeps reappearing in every poll batch.
   */
  static async setNextResumeAt(args: {
    pausedExecutionId: string
    nextResumeAt: Date | null
  }): Promise<void> {
    await execDb
      .update(pausedExecutions)
      .set({ nextResumeAt: args.nextResumeAt })
      .where(
        and(
          eq(pausedExecutions.id, args.pausedExecutionId),
          inArray(pausedExecutions.status, ['paused', 'partially_resumed'])
        )
      )
  }

  static async listPausedExecutions(options: {
    workflowId: string
    status?: string | string[]
  }): Promise<PausedExecutionSummary[]> {
    const { workflowId, status } = options

    let whereClause: SQL<unknown> | undefined = eq(pausedExecutions.workflowId, workflowId)

    if (status) {
      const statuses = Array.isArray(status)
        ? status
        : String(status)
            .split(',')
            .map((s) => s.trim())
      if (statuses.length === 1) {
        whereClause = and(whereClause, eq(pausedExecutions.status, statuses[0]))
      } else if (statuses.length > 1) {
        whereClause = and(whereClause, inArray(pausedExecutions.status, statuses))
      }
    }

    const rows = await execDb
      .select()
      .from(pausedExecutions)
      .where(whereClause)
      .orderBy(desc(pausedExecutions.pausedAt))

    return rows.flatMap((row) => {
      const humanPoints = PauseResumeManager.mapPausePoints(row.pausePoints).filter(
        (point) => point.pauseKind !== 'time'
      )
      if (humanPoints.length === 0) return []
      return [PauseResumeManager.normalizePausedExecution(row, humanPoints)]
    })
  }

  static async getPausedExecutionById(
    id: string
  ): Promise<typeof pausedExecutions.$inferSelect | null> {
    const rows = await execDb
      .select()
      .from(pausedExecutions)
      .where(eq(pausedExecutions.id, id))
      .limit(1)
    return rows[0] ?? null
  }

  static async getPausedExecutionDetail(options: {
    workflowId: string
    executionId: string
  }): Promise<PausedExecutionDetail | null> {
    const { workflowId, executionId } = options

    const row = await execDb
      .select()
      .from(pausedExecutions)
      .where(
        and(
          eq(pausedExecutions.workflowId, workflowId),
          eq(pausedExecutions.executionId, executionId)
        )
      )
      .limit(1)
      .then((rows) => rows[0])

    if (!row) {
      return null
    }

    const queueEntries = await execDb
      .select()
      .from(resumeQueue)
      .where(eq(resumeQueue.parentExecutionId, executionId))
      .orderBy(asc(resumeQueue.queuedAt))

    const normalizedQueue = queueEntries.map((entry) =>
      PauseResumeManager.normalizeQueueEntry(entry)
    )
    const queuePositions = PauseResumeManager.computeQueuePositions(normalizedQueue)
    const latestEntries = PauseResumeManager.computeLatestEntriesByContext(normalizedQueue)

    const pausePoints = PauseResumeManager.mapPausePoints(
      row.pausePoints,
      queuePositions,
      latestEntries
    ).filter((point) => point.pauseKind !== 'time')

    if (pausePoints.length === 0) {
      return null
    }

    const executionSummary = PauseResumeManager.normalizePausedExecution(row, pausePoints)

    return {
      ...executionSummary,
      executionSnapshot: row.executionSnapshot as SerializedSnapshot,
      queue: normalizedQueue,
    }
  }

  static async getPauseContextDetail(options: {
    workflowId: string
    executionId: string
    contextId: string
  }): Promise<PauseContextDetail | null> {
    const { workflowId, executionId, contextId } = options
    const detail = await PauseResumeManager.getPausedExecutionDetail({ workflowId, executionId })

    if (!detail) {
      return null
    }

    const pausePoint = detail.pausePoints.find((point) => point.contextId === contextId)
    if (!pausePoint) {
      return null
    }

    const activeResumeEntry = detail.queue.find(
      (entry) =>
        entry.contextId === contextId && (entry.status === 'claimed' || entry.status === 'pending')
    )

    // The selected pause point's full `response.data` is already returned via
    // `pausePoint` below; strip it from `execution.pausePoints` so a large
    // HITL display payload isn't duplicated in full within the same response.
    const execution: PausedExecutionDetail = {
      ...detail,
      pausePoints: detail.pausePoints.map((point) =>
        point.response ? { ...point, response: { ...point.response, data: undefined } } : point
      ),
    }

    return {
      execution,
      pausePoint,
      queue: detail.queue,
      activeResumeEntry,
    }
  }

  static async processQueuedResumes(parentExecutionId: string, workflowId: string): Promise<void> {
    let pendingEntry: {
      entry: typeof resumeQueue.$inferSelect
      pausedExecution: typeof pausedExecutions.$inferSelect
    } | null = null

    while (!pendingEntry) {
      const selection = await execDb.transaction(async (tx) => {
        const pausedExecution = await tx
          .select()
          .from(pausedExecutions)
          .where(
            and(
              eq(pausedExecutions.executionId, parentExecutionId),
              eq(pausedExecutions.workflowId, workflowId)
            )
          )
          .for('update')
          .limit(1)
          .then((rows) => rows[0])

        if (!pausedExecution || !isResumablePausedStatus(pausedExecution.status)) {
          return { action: 'empty' as const }
        }

        const activeResume = await tx
          .select({ id: resumeQueue.id })
          .from(resumeQueue)
          .where(
            and(
              eq(resumeQueue.parentExecutionId, parentExecutionId),
              eq(resumeQueue.status, 'claimed')
            )
          )
          .limit(1)
          .then((rows) => rows[0])

        if (activeResume) {
          return { action: 'active' as const }
        }

        const entry = await tx
          .select()
          .from(resumeQueue)
          .where(
            and(
              eq(resumeQueue.parentExecutionId, parentExecutionId),
              eq(resumeQueue.status, 'pending')
            )
          )
          .orderBy(asc(resumeQueue.queuedAt))
          .limit(1)
          .for('update')
          .then((rows) => rows[0])

        if (!entry) {
          return { action: 'empty' as const }
        }

        const pausePoints = pausedExecution.pausePoints as Record<string, any>
        const pausePoint = pausePoints?.[entry.contextId]
        if (!pausePoint || pausePoint.resumeStatus !== 'queued') {
          await tx
            .update(resumeQueue)
            .set({
              status: 'failed',
              completedAt: new Date(),
              failureReason: 'Pause point is no longer queued',
            })
            .where(eq(resumeQueue.id, entry.id))
          return { action: 'continue' as const }
        }

        await tx
          .update(resumeQueue)
          .set({ status: 'claimed', claimedAt: new Date() })
          .where(eq(resumeQueue.id, entry.id))

        await tx
          .update(pausedExecutions)
          .set({
            pausePoints: updatePausePointResumeStateSql(entry.contextId, 'resuming'),
            metadata: clearAutomaticResumeWaitingMetadataSql(entry.contextId),
          })
          .where(eq(pausedExecutions.id, pausedExecution.id))

        return { action: 'claimed' as const, entry, pausedExecution }
      })

      if (selection.action === 'empty') {
        return
      }
      if (selection.action === 'active') {
        return
      }
      if (selection.action === 'claimed') {
        pendingEntry = {
          entry: selection.entry,
          pausedExecution: selection.pausedExecution,
        }
      }
    }

    const { entry, pausedExecution } = pendingEntry
    const resumeMetadata = parsePausedExecutionResumeMetadata(pausedExecution.metadata)
    const pausedMetadata = isRecordLike(pausedExecution.metadata) ? pausedExecution.metadata : {}

    PauseResumeManager.startResumeExecution({
      resumeEntryId: entry.id,
      resumeExecutionId: entry.newExecutionId,
      pausedExecution,
      contextId: entry.contextId,
      resumeInput: entry.resumeInput,
      userId:
        resumeMetadata?.executorUserId ??
        (typeof pausedMetadata.executorUserId === 'string' ? pausedMetadata.executorUserId : ''),
    }).catch((error) => {
      logger.error(
        'Failed to start queued resume execution',
        projectResolvedSecretDiagnosticError(error, undefined, {
          parentExecutionId,
          resumeEntryId: entry.id,
        })
      )
    })
  }

  private static normalizeQueueEntry(
    entry: typeof resumeQueue.$inferSelect
  ): ResumeQueueEntrySummary {
    return {
      id: entry.id,
      pausedExecutionId: entry.pausedExecutionId,
      parentExecutionId: entry.parentExecutionId,
      newExecutionId: entry.newExecutionId,
      contextId: entry.contextId,
      resumeInput: entry.resumeInput,
      status: entry.status,
      queuedAt: entry.queuedAt ? entry.queuedAt.toISOString() : null,
      claimedAt: entry.claimedAt ? entry.claimedAt.toISOString() : null,
      completedAt: entry.completedAt ? entry.completedAt.toISOString() : null,
      failureReason: entry.failureReason ?? null,
    }
  }

  private static normalizePausedExecution(
    row: typeof pausedExecutions.$inferSelect,
    pausePoints: PausePointWithQueue[]
  ): PausedExecutionSummary {
    return {
      id: row.id,
      workflowId: row.workflowId,
      executionId: row.executionId,
      status: row.status,
      totalPauseCount: pausePoints.length,
      resumedCount: pausePoints.filter((point) => point.resumeStatus === 'resumed').length,
      pausedAt: row.pausedAt ? row.pausedAt.toISOString() : null,
      updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
      expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
      metadata: row.metadata as Record<string, any>,
      triggerIds: (row.executionSnapshot as SerializedSnapshot)?.triggerIds || [],
      pausePoints,
    }
  }

  private static mapPausePoints(
    pausePoints: unknown,
    queuePositions?: Map<string, number | null>,
    latestEntries?: Map<string, ResumeQueueEntrySummary>
  ): PausePointWithQueue[] {
    const record = pausePoints as Record<string, PausePoint> | null
    if (!record) {
      return []
    }

    return Object.values(record).map((point: PausePoint) => {
      const queuePosition = queuePositions?.get(point.contextId ?? '') ?? null
      const latestEntry = latestEntries?.get(point.contextId ?? '')

      const blockId = PauseResumeManager.normalizePauseBlockId(point.blockId ?? point.contextId)

      const resumeLinks = point.resumeLinks
        ? {
            ...point.resumeLinks,
            uiUrl:
              typeof point.resumeLinks.uiUrl === 'string'
                ? point.resumeLinks.uiUrl.split('?')[0]
                : point.resumeLinks.uiUrl,
          }
        : undefined

      return {
        contextId: point.contextId,
        blockId,
        response: point.response,
        registeredAt: point.registeredAt,
        resumeStatus: point.resumeStatus || 'paused',
        automaticResumeWaitingReason:
          typeof point.automaticResumeWaitingReason === 'string'
            ? point.automaticResumeWaitingReason
            : undefined,
        snapshotReady: Boolean(point.snapshotReady),
        parallelScope: point.parallelScope,
        loopScope: point.loopScope,
        resumeLinks,
        pauseKind: point.pauseKind ?? 'human',
        resumeAt: point.resumeAt,
        queuePosition,
        latestResumeEntry: latestEntry ?? null,
      }
    })
  }

  private static computeQueuePositions(
    queueEntries: ResumeQueueEntrySummary[]
  ): Map<string, number | null> {
    const pendingEntries = queueEntries
      .filter((entry) => entry.status === 'pending')
      .sort((a, b) => {
        const aTime = a.queuedAt ? Date.parse(a.queuedAt) : 0
        const bTime = b.queuedAt ? Date.parse(b.queuedAt) : 0
        return aTime - bTime
      })

    const positions = new Map<string, number | null>()
    pendingEntries.forEach((entry, index) => {
      if (!positions.has(entry.contextId)) {
        positions.set(entry.contextId, index + 1)
      }
    })

    return positions
  }

  private static computeLatestEntriesByContext(
    queueEntries: ResumeQueueEntrySummary[]
  ): Map<string, ResumeQueueEntrySummary> {
    const latestEntries = new Map<string, ResumeQueueEntrySummary>()

    queueEntries.forEach((entry) => {
      const existing = latestEntries.get(entry.contextId)
      if (!existing) {
        latestEntries.set(entry.contextId, entry)
        return
      }

      const existingTime = existing.queuedAt ? Date.parse(existing.queuedAt) : 0
      const currentTime = entry.queuedAt ? Date.parse(entry.queuedAt) : 0

      if (currentTime >= existingTime) {
        latestEntries.set(entry.contextId, entry)
      }
    })

    return latestEntries
  }

  private static normalizePauseBlockId(id?: string | null): string {
    if (!id) {
      return ''
    }

    const normalized = id.replace(/_loop\d+/g, '')

    return normalized || id
  }
}
