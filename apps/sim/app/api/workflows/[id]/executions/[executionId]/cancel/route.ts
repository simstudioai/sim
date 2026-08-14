import { db } from '@sim/db'
import { workflowExecutionLogs } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type CancelWorkflowExecutionResponse,
  cancelWorkflowExecutionContract,
} from '@/lib/api/contracts/workflows'
import { parseRequest } from '@/lib/api/server'
import { WORKSPACE_KEY_SCOPE_DENIED } from '@/lib/api-key/policy-messages'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { releaseExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import { getJobQueue } from '@/lib/core/async-jobs'
import type { ExecutionJobCancellationScope } from '@/lib/core/async-jobs/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import {
  clearExecutionCancellation,
  type ExecutionCancellationRecordResult,
  markExecutionCancelled,
} from '@/lib/execution/cancellation'
import { createExecutionEventWriter, readExecutionMetaState } from '@/lib/execution/event-buffer'
import { abortManualExecution } from '@/lib/execution/manual-cancellation'
import { cancelledExecutionLogFields } from '@/lib/logs/execution/cancellation'
import { workflowExecutionOriginSql } from '@/lib/logs/execution-origin'
import { captureServerEvent } from '@/lib/posthog/server'
import {
  cancelWorkflowGroupExecution,
  type PublishableWorkflowGroupCancellation,
  publishWorkflowGroupCancellationEvent,
} from '@/lib/table/workflow-group-cancellation'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'

const logger = createLogger('CancelExecutionAPI')
const PAUSED_CANCELLATION_DB_ATTEMPTS = 3
const PAUSED_CANCELLATION_DB_RETRY_MS = 200

/**
 * Builds the single success shape this route returns. The route hand-builds its
 * responses rather than going through a declarative builder, so nothing else
 * checks that they satisfy the contract the client validates against — and
 * several outcomes the route resolves itself (a still-queued run, an
 * already-cancelled run) ride on `success: true`, where a rejected body turns a
 * cancellation that worked into a client-side failure.
 */
function cancellationOutcome(body: CancelWorkflowExecutionResponse) {
  return NextResponse.json(body)
}

async function cancelQueuedExecutionJobs(
  workflowId: string,
  executionId: string,
  scope: ExecutionJobCancellationScope
): Promise<number> {
  try {
    const queue = await getJobQueue()
    return await queue.cancelByExecution({ workflowId, executionId }, scope)
  } catch (error) {
    logger.warn('Failed to cancel queued execution jobs', {
      workflowId,
      executionId,
      error: toError(error).message,
    })
    return 0
  }
}

function abortLocalExecution(executionId: string): boolean {
  try {
    return abortManualExecution(executionId)
  } catch (error) {
    logger.warn('Failed to abort local execution', {
      executionId,
      error: toError(error).message,
    })
    return false
  }
}

interface ExecutionStopSignalResult {
  cancellation: ExecutionCancellationRecordResult
  locallyAborted: boolean
  queueJobsCancelled: number
  accepted: boolean
}

interface ExecutionStopSummary extends ExecutionStopSignalResult {
  signalledExecutionIds: Set<string>
}

function createExecutionStopSummary(): ExecutionStopSummary {
  return {
    cancellation: { durablyRecorded: false, reason: 'redis_unavailable' },
    locallyAborted: false,
    queueJobsCancelled: 0,
    accepted: false,
    signalledExecutionIds: new Set<string>(),
  }
}

function mergeExecutionStopSignal(
  summary: ExecutionStopSummary,
  signalExecutionId: string,
  result: ExecutionStopSignalResult
): void {
  if (result.cancellation.durablyRecorded || !summary.cancellation.durablyRecorded) {
    summary.cancellation = result.cancellation
  }
  summary.locallyAborted = summary.locallyAborted || result.locallyAborted
  summary.queueJobsCancelled += result.queueJobsCancelled
  summary.accepted = summary.accepted || result.accepted
  summary.signalledExecutionIds.add(signalExecutionId)
}

async function signalExecutionStop(args: {
  workflowId: string
  signalExecutionId: string
  queueBindingExecutionId?: string
  executionDeadlineAt: Date | null
  queueScope?: ExecutionJobCancellationScope
}): Promise<ExecutionStopSignalResult> {
  const cancellation = await markExecutionCancelled(args.signalExecutionId, {
    executionDeadlineAt: args.executionDeadlineAt,
  })
  const locallyAborted = abortLocalExecution(args.signalExecutionId)
  const queueJobsCancelled = args.queueScope
    ? await cancelQueuedExecutionJobs(
        args.workflowId,
        args.queueBindingExecutionId ?? args.signalExecutionId,
        args.queueScope
      )
    : 0
  return {
    cancellation,
    locallyAborted,
    queueJobsCancelled,
    accepted: cancellation.durablyRecorded || locallyAborted || queueJobsCancelled > 0,
  }
}

async function signalActiveResumeStop(args: {
  workflowId: string
  executionId: string
  executionDeadlineAt: Date | null
  target: NonNullable<
    Awaited<ReturnType<typeof PauseResumeManager.getActiveResumeCancellationTarget>>
  >
}): Promise<{
  target: NonNullable<
    Awaited<ReturnType<typeof PauseResumeManager.getActiveResumeCancellationTarget>>
  >
  signal: ExecutionStopSignalResult
}> {
  const signal = await signalExecutionStop({
    workflowId: args.workflowId,
    signalExecutionId: args.target.resumeExecutionId,
    queueBindingExecutionId: args.executionId,
    executionDeadlineAt: args.executionDeadlineAt,
    queueScope: 'resume',
  })
  return { target: args.target, signal }
}

async function didActiveResumeStop(
  executionId: string,
  workflowId: string,
  target: NonNullable<
    Awaited<ReturnType<typeof PauseResumeManager.getActiveResumeCancellationTarget>>
  >,
  signal: ExecutionStopSignalResult
): Promise<boolean> {
  if (signal.accepted) return true
  const currentTarget = await PauseResumeManager.getActiveResumeCancellationTarget(
    executionId,
    workflowId
  )
  if (currentTarget && currentTarget.resumeEntryId !== target.resumeEntryId) {
    logger.warn('A replacement resume became active while cancellation was staged', {
      executionId,
      previousResumeEntryId: target.resumeEntryId,
      currentResumeEntryId: currentTarget.resumeEntryId,
    })
  }
  return currentTarget === null
}

type PausedCancellationStage = Awaited<
  ReturnType<typeof PauseResumeManager.stagePausedCancellation>
>

function isPausedCancellationStage(
  stage: PausedCancellationStage
): stage is Exclude<PausedCancellationStage, { kind: 'not_paused' }> {
  return stage.kind !== 'not_paused'
}

async function clearStopSignalMarkers(summary: ExecutionStopSummary): Promise<void> {
  await Promise.all(
    [...summary.signalledExecutionIds].map((executionId) => clearExecutionCancellation(executionId))
  )
}

type ExecutionLogCancellationClaim =
  | { kind: 'cancelled' }
  | { kind: 'conflict'; status: string }
  | { kind: 'not_found' }

async function claimExecutionLogCancellation(args: {
  executionId: string
  workflowId: string
  workspaceId: string
}): Promise<ExecutionLogCancellationClaim> {
  const now = new Date()
  const [cancelledExecution] = await db
    .update(workflowExecutionLogs)
    .set(cancelledExecutionLogFields(now))
    .where(
      and(
        eq(workflowExecutionLogs.executionId, args.executionId),
        eq(workflowExecutionLogs.workflowId, args.workflowId),
        eq(workflowExecutionLogs.workspaceId, args.workspaceId),
        inArray(workflowExecutionLogs.status, ['running', 'pending'])
      )
    )
    .returning({ status: workflowExecutionLogs.status })

  if (cancelledExecution?.status === 'cancelled') return { kind: 'cancelled' }

  const currentExecution = await db
    .select({ status: workflowExecutionLogs.status })
    .from(workflowExecutionLogs)
    .where(
      and(
        eq(workflowExecutionLogs.executionId, args.executionId),
        eq(workflowExecutionLogs.workflowId, args.workflowId),
        eq(workflowExecutionLogs.workspaceId, args.workspaceId)
      )
    )
    .limit(1)
    .then((rows) => rows[0])

  if (!currentExecution) return { kind: 'not_found' }
  if (currentExecution.status === 'cancelled') return { kind: 'cancelled' }
  return { kind: 'conflict', status: currentExecution.status }
}

async function completePausedCancellationWithRetry(
  executionId: string,
  workflowId: string,
  options: { logMissing?: boolean } = {}
): Promise<boolean> {
  for (let attempt = 1; attempt <= PAUSED_CANCELLATION_DB_ATTEMPTS; attempt++) {
    try {
      const cancelled = await PauseResumeManager.completePausedCancellation(executionId, workflowId)
      if (cancelled) {
        logger.info('Paused execution cancelled in database', { executionId, attempt })
        return true
      }
      if (options.logMissing !== false) {
        logger.warn('Paused execution cancellation could not be completed in database', {
          executionId,
          attempt,
        })
      }
      return false
    } catch (error) {
      logger.warn('Failed to complete paused execution cancellation in database', {
        executionId,
        attempt,
        error,
      })
      if (attempt < PAUSED_CANCELLATION_DB_ATTEMPTS) {
        await sleep(PAUSED_CANCELLATION_DB_RETRY_MS)
      }
    }
  }
  return false
}

async function ensureCancellationEventPublished(
  executionId: string,
  workflowId: string,
  context: { workspaceId?: string; userId?: string } = {}
): Promise<boolean> {
  try {
    const metaState = await readExecutionMetaState(executionId)
    if (metaState.status === 'found' && metaState.meta.status === 'cancelled') {
      return true
    }
  } catch (error) {
    logger.warn('Failed to read execution state before publishing cancellation', {
      executionId,
      error: toError(error).message,
    })
  }

  const writer = createExecutionEventWriter(executionId, {
    workspaceId: context.workspaceId,
    workflowId,
    userId: context.userId,
  })
  try {
    await writer.writeTerminal(
      {
        type: 'execution:cancelled',
        timestamp: new Date().toISOString(),
        executionId,
        workflowId,
        data: { duration: 0 },
      },
      'cancelled'
    )
    return true
  } catch (error) {
    logger.warn('Failed to publish execution cancellation event', {
      executionId,
      error,
    })
    return false
  } finally {
    await writer.close().catch((error) => {
      logger.warn('Failed to close cancellation event writer', {
        executionId,
        error,
      })
    })
  }
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withRouteHandler(
  async (req: NextRequest, context: { params: Promise<{ id: string; executionId: string }> }) => {
    const auth = await checkHybridAuth(req, { requireWorkflowId: false })
    if (!auth.success || !auth.userId) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(cancelWorkflowExecutionContract, req, context)
    if (!parsed.success) return parsed.response
    const { id: workflowId, executionId } = parsed.data.params

    try {
      const workflowAuthorization = await authorizeWorkflowByWorkspacePermission({
        workflowId,
        userId: auth.userId,
        action: 'write',
      })
      if (!workflowAuthorization.allowed) {
        return NextResponse.json(
          { error: workflowAuthorization.message || 'Access denied' },
          { status: workflowAuthorization.status }
        )
      }

      if (
        auth.apiKeyType === 'workspace' &&
        workflowAuthorization.workflow?.workspaceId !== auth.workspaceId
      ) {
        return NextResponse.json({ error: WORKSPACE_KEY_SCOPE_DENIED }, { status: 403 })
      }

      const execution = await db
        .select({
          executionDeadlineAt: workflowExecutionLogs.executionDeadlineAt,
          executionOrigin: workflowExecutionOriginSql(),
          status: workflowExecutionLogs.status,
          workspaceId: workflowExecutionLogs.workspaceId,
        })
        .from(workflowExecutionLogs)
        .where(
          and(
            eq(workflowExecutionLogs.executionId, executionId),
            eq(workflowExecutionLogs.workflowId, workflowId)
          )
        )
        .limit(1)
        .then((rows) => rows[0])

      if (!execution) {
        const queueJobsCancelled = await cancelQueuedExecutionJobs(
          workflowId,
          executionId,
          'standalone'
        )
        if (queueJobsCancelled > 0) {
          const locallyAborted = abortLocalExecution(executionId)
          const cancellation = await markExecutionCancelled(executionId)
          await PauseResumeManager.blockQueuedResumesForCancellation(executionId, workflowId).catch(
            (error) => {
              logger.warn('Failed to block queued resumes after queued-run cancellation', {
                executionId,
                error,
              })
            }
          )
          await releaseExecutionSlot(executionId).catch((error) => {
            logger.warn('Failed to release reservation after queued-run cancellation', {
              executionId,
              error,
            })
          })

          const workspaceId = workflowAuthorization.workflow?.workspaceId
          captureServerEvent(
            auth.userId,
            'workflow_execution_cancelled',
            { workflow_id: workflowId, workspace_id: workspaceId ?? '' },
            workspaceId ? { groups: { workspace: workspaceId } } : undefined
          )

          return cancellationOutcome({
            success: true,
            executionId,
            redisAvailable: cancellation.reason !== 'redis_unavailable',
            durablyRecorded: cancellation.durablyRecorded,
            locallyAborted,
            pausedCancelled: false,
            reason: 'queue_cancelled',
          })
        }

        return NextResponse.json({ error: 'Execution not found' }, { status: 404 })
      }

      const authorizedWorkspaceId = workflowAuthorization.workflow?.workspaceId
      if (authorizedWorkspaceId && execution.workspaceId !== authorizedWorkspaceId) {
        return NextResponse.json({ error: 'Execution not found' }, { status: 404 })
      }

      const isWorkflowGroupExecution = execution.executionOrigin === 'workflow_group'

      if (execution.status === 'cancelled') {
        let groupCancellationToPublish: PublishableWorkflowGroupCancellation | null = null
        if (isWorkflowGroupExecution) {
          const workflowGroupCancellation = await cancelWorkflowGroupExecution({
            workspaceId: execution.workspaceId,
            workflowId,
            executionId,
          })
          if (workflowGroupCancellation.kind === 'conflict') {
            return NextResponse.json(
              {
                error: `Workflow group execution cannot be reconciled while ${workflowGroupCancellation.status}`,
              },
              { status: 409 }
            )
          }
          if (workflowGroupCancellation.kind === 'not_workflow_group') {
            return NextResponse.json(
              { error: 'Workflow group execution is no longer the active table execution' },
              { status: 409 }
            )
          }
          if (
            workflowGroupCancellation.kind === 'cancelled' ||
            workflowGroupCancellation.kind === 'already_cancelled'
          ) {
            groupCancellationToPublish = workflowGroupCancellation
          }
        }

        const stopSummary = createExecutionStopSummary()
        let pausedCancelled = false
        const pausedCancellationStage = await PauseResumeManager.stagePausedCancellation(
          executionId,
          workflowId
        )
        const hasPausedCancellation = isPausedCancellationStage(pausedCancellationStage)
        const requiresCancellationEvent = hasPausedCancellation || isWorkflowGroupExecution
        let cancellationEventPublished = !requiresCancellationEvent
        let activeResumeSignalFailed = false
        let exactStopSatisfied = true
        if (pausedCancellationStage.kind === 'active_resume') {
          const activeResumeStop = await signalActiveResumeStop({
            workflowId,
            executionId,
            executionDeadlineAt: execution.executionDeadlineAt,
            target: pausedCancellationStage.target,
          })
          mergeExecutionStopSignal(
            stopSummary,
            activeResumeStop.target.resumeExecutionId,
            activeResumeStop.signal
          )
          exactStopSatisfied = await didActiveResumeStop(
            executionId,
            workflowId,
            activeResumeStop.target,
            activeResumeStop.signal
          )
          activeResumeSignalFailed = !exactStopSatisfied
        } else if (isWorkflowGroupExecution && !hasPausedCancellation) {
          const retrySignal = await signalExecutionStop({
            workflowId,
            signalExecutionId: executionId,
            executionDeadlineAt: execution.executionDeadlineAt,
          })
          mergeExecutionStopSignal(stopSummary, executionId, retrySignal)
          exactStopSatisfied = retrySignal.accepted
        }

        if (groupCancellationToPublish && exactStopSatisfied) {
          await publishWorkflowGroupCancellationEvent(groupCancellationToPublish, executionId)
        }

        if (requiresCancellationEvent && exactStopSatisfied) {
          cancellationEventPublished = await ensureCancellationEventPublished(
            executionId,
            workflowId,
            {
              workspaceId: execution.workspaceId,
              userId: auth.userId,
            }
          )
        }
        if (hasPausedCancellation && cancellationEventPublished && exactStopSatisfied) {
          pausedCancelled = await completePausedCancellationWithRetry(executionId, workflowId, {
            logMissing: false,
          })
        }

        if (exactStopSatisfied) {
          await releaseExecutionSlot(executionId).catch((error) => {
            logger.warn('Failed to release reservation while reconciling cancelled execution', {
              executionId,
              error: toError(error).message,
            })
          })
        }

        if (pausedCancelled) {
          await clearStopSignalMarkers(stopSummary)
        }

        const pausedReconciliationSucceeded =
          exactStopSatisfied &&
          (!hasPausedCancellation || (cancellationEventPublished && pausedCancelled))
        return cancellationOutcome({
          success: pausedReconciliationSucceeded,
          executionId,
          redisAvailable: requiresCancellationEvent ? cancellationEventPublished : true,
          durablyRecorded: false,
          locallyAborted: stopSummary.locallyAborted,
          pausedCancelled,
          reason: activeResumeSignalFailed
            ? 'active_resume_signal_failed'
            : !exactStopSatisfied
              ? stopSummary.cancellation.reason
              : hasPausedCancellation && !cancellationEventPublished
                ? 'paused_event_publish_failed'
                : hasPausedCancellation && !pausedCancelled
                  ? 'paused_database_cancel_failed'
                  : 'already_cancelled',
        })
      }

      if (execution.status !== 'running' && execution.status !== 'pending') {
        return NextResponse.json(
          { error: `Execution cannot be cancelled while ${execution.status}` },
          { status: 409 }
        )
      }

      logger.info('Cancel execution requested', { workflowId, executionId, userId: auth.userId })

      const stopSummary = createExecutionStopSummary()
      let pausedCancelled = false
      let pausedCancellationStage = await PauseResumeManager.stagePausedCancellation(
        executionId,
        workflowId
      )
      let effectivePausedCancellationPath = isPausedCancellationStage(pausedCancellationStage)
      let activeResumeTarget =
        pausedCancellationStage.kind === 'active_resume' ? pausedCancellationStage.target : null
      let activeResumeEntryId = activeResumeTarget?.resumeEntryId ?? null
      let activeResumeSignalAccepted = false

      if (activeResumeTarget && !isWorkflowGroupExecution) {
        const activeResumeStop = await signalActiveResumeStop({
          workflowId,
          executionId,
          executionDeadlineAt: execution.executionDeadlineAt,
          target: activeResumeTarget,
        })
        mergeExecutionStopSignal(
          stopSummary,
          activeResumeStop.target.resumeExecutionId,
          activeResumeStop.signal
        )
        activeResumeSignalAccepted = await didActiveResumeStop(
          executionId,
          workflowId,
          activeResumeStop.target,
          activeResumeStop.signal
        )

        if (!activeResumeSignalAccepted) {
          const failedResumeEntryId = activeResumeTarget.resumeEntryId
          await PauseResumeManager.rollbackActiveResumeCancellation(
            executionId,
            workflowId,
            failedResumeEntryId
          ).catch((error) => {
            logger.warn('Failed to roll back active resume cancellation intent', {
              executionId,
              activeResumeEntryId: failedResumeEntryId,
              error: toError(error).message,
            })
          })
          await clearStopSignalMarkers(stopSummary)
          return cancellationOutcome({
            success: false,
            executionId,
            redisAvailable: stopSummary.cancellation.reason !== 'redis_unavailable',
            durablyRecorded: stopSummary.cancellation.durablyRecorded,
            locallyAborted: stopSummary.locallyAborted,
            pausedCancelled: false,
            reason: 'active_resume_signal_failed',
          })
        }
      } else if (!effectivePausedCancellationPath && !isWorkflowGroupExecution) {
        const signal = await signalExecutionStop({
          workflowId,
          signalExecutionId: executionId,
          executionDeadlineAt: execution.executionDeadlineAt,
          queueScope: 'standalone',
        })
        mergeExecutionStopSignal(stopSummary, executionId, signal)

        if (!signal.accepted) {
          pausedCancellationStage = await PauseResumeManager.stagePausedCancellation(
            executionId,
            workflowId
          )
          effectivePausedCancellationPath = isPausedCancellationStage(pausedCancellationStage)
          activeResumeTarget =
            pausedCancellationStage.kind === 'active_resume' ? pausedCancellationStage.target : null
          activeResumeEntryId = activeResumeTarget?.resumeEntryId ?? null

          if (activeResumeTarget) {
            const activeResumeStop = await signalActiveResumeStop({
              workflowId,
              executionId,
              executionDeadlineAt: execution.executionDeadlineAt,
              target: activeResumeTarget,
            })
            mergeExecutionStopSignal(
              stopSummary,
              activeResumeStop.target.resumeExecutionId,
              activeResumeStop.signal
            )
            activeResumeSignalAccepted = await didActiveResumeStop(
              executionId,
              workflowId,
              activeResumeStop.target,
              activeResumeStop.signal
            )
            if (!activeResumeSignalAccepted) {
              const failedResumeEntryId = activeResumeTarget.resumeEntryId
              await PauseResumeManager.rollbackActiveResumeCancellation(
                executionId,
                workflowId,
                failedResumeEntryId
              ).catch((error) => {
                logger.warn('Failed to roll back late active resume cancellation intent', {
                  executionId,
                  activeResumeEntryId: failedResumeEntryId,
                  error: toError(error).message,
                })
              })
              await clearStopSignalMarkers(stopSummary)
              return cancellationOutcome({
                success: false,
                executionId,
                redisAvailable: stopSummary.cancellation.reason !== 'redis_unavailable',
                durablyRecorded: stopSummary.cancellation.durablyRecorded,
                locallyAborted: stopSummary.locallyAborted,
                pausedCancelled: false,
                reason: 'active_resume_signal_failed',
              })
            }
          } else if (!effectivePausedCancellationPath) {
            return cancellationOutcome({
              success: false,
              executionId,
              redisAvailable: stopSummary.cancellation.reason !== 'redis_unavailable',
              durablyRecorded: stopSummary.cancellation.durablyRecorded,
              locallyAborted: stopSummary.locallyAborted,
              pausedCancelled: false,
              reason: stopSummary.cancellation.reason,
            })
          }
        }
      }

      let terminalCancellationClaimed = false
      let competingTerminalStatus: string | null = null
      let workflowGroupNoLongerActive = false
      let groupCancellationToPublish: PublishableWorkflowGroupCancellation | null = null
      try {
        if (isWorkflowGroupExecution) {
          const workflowGroupCancellation = await cancelWorkflowGroupExecution({
            workspaceId: execution.workspaceId,
            workflowId,
            executionId,
          })
          if (workflowGroupCancellation.kind === 'conflict') {
            competingTerminalStatus = workflowGroupCancellation.status
          } else if (workflowGroupCancellation.kind === 'not_workflow_group') {
            workflowGroupNoLongerActive = true
          } else {
            terminalCancellationClaimed = true
            if (
              workflowGroupCancellation.kind === 'cancelled' ||
              workflowGroupCancellation.kind === 'already_cancelled'
            ) {
              groupCancellationToPublish = workflowGroupCancellation
            }
          }
        } else {
          const claim = await claimExecutionLogCancellation({
            executionId,
            workflowId,
            workspaceId: execution.workspaceId,
          })
          if (claim.kind === 'cancelled') {
            terminalCancellationClaimed = true
          } else {
            competingTerminalStatus = claim.kind === 'conflict' ? claim.status : 'no_longer_active'
          }
        }
      } catch (dbError) {
        logger.warn('Failed to finalize cancelled execution directly', {
          executionId,
          error: toError(dbError).message,
        })
      }

      if (workflowGroupNoLongerActive) {
        await clearStopSignalMarkers(stopSummary)
        if (activeResumeEntryId) {
          await PauseResumeManager.rollbackActiveResumeCancellation(
            executionId,
            workflowId,
            activeResumeEntryId
          ).catch((error) => {
            logger.warn('Failed to roll back active resume after group target disappeared', {
              executionId,
              activeResumeEntryId,
              error: toError(error).message,
            })
          })
        } else if (effectivePausedCancellationPath) {
          await PauseResumeManager.clearPausedCancellationIntent(executionId, workflowId).catch(
            (error) => {
              logger.warn('Failed to clear cancellation intent after group target disappeared', {
                executionId,
                error: toError(error).message,
              })
            }
          )
        }
        return NextResponse.json(
          { error: 'Workflow group execution is no longer the active table execution' },
          { status: 409 }
        )
      }

      if (competingTerminalStatus) {
        await clearStopSignalMarkers(stopSummary)
        if (activeResumeEntryId) {
          await PauseResumeManager.rollbackActiveResumeCancellation(
            executionId,
            workflowId,
            activeResumeEntryId
          ).catch((error) => {
            logger.warn('Failed to roll back active resume after terminal race', {
              executionId,
              activeResumeEntryId,
              error: toError(error).message,
            })
          })
        } else if (effectivePausedCancellationPath) {
          await PauseResumeManager.clearPausedCancellationIntent(executionId, workflowId).catch(
            (error) => {
              logger.warn('Failed to clear cancellation intent after terminal race', {
                executionId,
                error: toError(error).message,
              })
            }
          )
        }
        return NextResponse.json(
          {
            error: isWorkflowGroupExecution
              ? `Workflow group execution cannot be cancelled while ${competingTerminalStatus}`
              : `Execution cannot be cancelled while ${competingTerminalStatus}`,
          },
          { status: 409 }
        )
      }

      if (!terminalCancellationClaimed) {
        if (effectivePausedCancellationPath && !stopSummary.accepted) {
          if (activeResumeEntryId) {
            await PauseResumeManager.rollbackActiveResumeCancellation(
              executionId,
              workflowId,
              activeResumeEntryId
            )
          } else {
            await PauseResumeManager.clearPausedCancellationIntent(executionId, workflowId)
          }
        }
        return cancellationOutcome({
          success: false,
          executionId,
          redisAvailable: stopSummary.cancellation.reason !== 'redis_unavailable',
          durablyRecorded: stopSummary.cancellation.durablyRecorded,
          locallyAborted: stopSummary.locallyAborted,
          pausedCancelled: false,
          reason: 'cancellation_not_finalized',
        })
      }

      let pauseReconciliationFailed = false
      let activeResumeSignalFailed = false
      if (isWorkflowGroupExecution) {
        if (activeResumeTarget) {
          const activeResumeStop = await signalActiveResumeStop({
            workflowId,
            executionId,
            executionDeadlineAt: execution.executionDeadlineAt,
            target: activeResumeTarget,
          })
          mergeExecutionStopSignal(
            stopSummary,
            activeResumeStop.target.resumeExecutionId,
            activeResumeStop.signal
          )
          activeResumeSignalAccepted = await didActiveResumeStop(
            executionId,
            workflowId,
            activeResumeStop.target,
            activeResumeStop.signal
          )
          activeResumeSignalFailed = !activeResumeSignalAccepted
        } else if (!effectivePausedCancellationPath) {
          const groupSignal = await signalExecutionStop({
            workflowId,
            signalExecutionId: executionId,
            executionDeadlineAt: execution.executionDeadlineAt,
          })
          mergeExecutionStopSignal(stopSummary, executionId, groupSignal)
        }
      }

      try {
        const postClaimPausedCancellationStage = await PauseResumeManager.stagePausedCancellation(
          executionId,
          workflowId
        )
        if (isPausedCancellationStage(postClaimPausedCancellationStage)) {
          effectivePausedCancellationPath = true
          pausedCancellationStage = postClaimPausedCancellationStage
          if (postClaimPausedCancellationStage.kind === 'active_resume') {
            const currentActiveResume = postClaimPausedCancellationStage.target
            const alreadyAttemptedCurrentResume =
              currentActiveResume.resumeEntryId === activeResumeEntryId &&
              stopSummary.signalledExecutionIds.has(currentActiveResume.resumeExecutionId)
            if (!alreadyAttemptedCurrentResume) {
              const activeResumeStop = await signalActiveResumeStop({
                workflowId,
                executionId,
                executionDeadlineAt: execution.executionDeadlineAt,
                target: currentActiveResume,
              })
              activeResumeEntryId = activeResumeStop.target.resumeEntryId
              activeResumeTarget = activeResumeStop.target
              mergeExecutionStopSignal(
                stopSummary,
                activeResumeStop.target.resumeExecutionId,
                activeResumeStop.signal
              )
              activeResumeSignalAccepted = await didActiveResumeStop(
                executionId,
                workflowId,
                activeResumeStop.target,
                activeResumeStop.signal
              )
            }
            activeResumeSignalFailed = !activeResumeSignalAccepted
          } else {
            activeResumeSignalFailed = false
          }
        }
      } catch (error) {
        pauseReconciliationFailed = true
        effectivePausedCancellationPath = true
        logger.warn('Failed to recheck paused execution after terminal cancellation claim', {
          executionId,
          error: toError(error).message,
        })
      }

      const executionStopSatisfied = effectivePausedCancellationPath
        ? !activeResumeSignalFailed
        : stopSummary.accepted
      if (groupCancellationToPublish && executionStopSatisfied && !pauseReconciliationFailed) {
        await publishWorkflowGroupCancellationEvent(groupCancellationToPublish, executionId)
      }
      let cancellationEventPublished = false
      if (executionStopSatisfied && !pauseReconciliationFailed) {
        cancellationEventPublished = await ensureCancellationEventPublished(
          executionId,
          workflowId,
          {
            workspaceId: execution.workspaceId,
            userId: auth.userId,
          }
        )
      }

      if (effectivePausedCancellationPath) {
        if (cancellationEventPublished && !pauseReconciliationFailed && !activeResumeSignalFailed) {
          pausedCancelled = await completePausedCancellationWithRetry(executionId, workflowId)
        }
      } else if (executionStopSatisfied) {
        await releaseExecutionSlot(executionId).catch((error) => {
          logger.warn('Failed to release reservation after execution cancellation', {
            executionId,
            error: toError(error).message,
          })
        })
      }

      const success = effectivePausedCancellationPath
        ? pausedCancelled &&
          cancellationEventPublished &&
          !pauseReconciliationFailed &&
          !activeResumeSignalFailed
        : executionStopSatisfied

      if (effectivePausedCancellationPath && pausedCancelled && cancellationEventPublished) {
        await clearStopSignalMarkers(stopSummary)
      }

      if (success) {
        const workspaceId = execution.workspaceId
        captureServerEvent(
          auth.userId,
          'workflow_execution_cancelled',
          { workflow_id: workflowId, workspace_id: workspaceId ?? '' },
          workspaceId ? { groups: { workspace: workspaceId } } : undefined
        )
      }

      const durablyRecorded = effectivePausedCancellationPath
        ? true
        : stopSummary.cancellation.durablyRecorded
      const reason = activeResumeSignalFailed
        ? 'active_resume_signal_failed'
        : pauseReconciliationFailed
          ? 'paused_database_cancel_failed'
          : effectivePausedCancellationPath && !cancellationEventPublished
            ? 'paused_event_publish_failed'
            : effectivePausedCancellationPath && !pausedCancelled
              ? 'paused_database_cancel_failed'
              : effectivePausedCancellationPath
                ? 'recorded'
                : stopSummary.queueJobsCancelled > 0 &&
                    !stopSummary.cancellation.durablyRecorded &&
                    !stopSummary.locallyAborted
                  ? 'queue_cancelled'
                  : stopSummary.cancellation.reason

      return cancellationOutcome({
        success,
        executionId,
        redisAvailable:
          effectivePausedCancellationPath || pausedCancelled
            ? cancellationEventPublished
            : stopSummary.cancellation.reason !== 'redis_unavailable',
        durablyRecorded,
        locallyAborted: stopSummary.locallyAborted,
        pausedCancelled,
        reason,
      })
    } catch (error) {
      logger.error('Failed to cancel execution', {
        workflowId,
        executionId,
        error: toError(error).message,
      })
      return NextResponse.json(
        { error: toError(error).message || 'Failed to cancel execution' },
        { status: 500 }
      )
    }
  }
)
