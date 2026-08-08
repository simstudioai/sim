import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { type NextRequest, NextResponse } from 'next/server'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import { getJobQueue, shouldExecuteInline } from '@/lib/core/async-jobs'
import type { AsyncExecutionCorrelation } from '@/lib/core/async-jobs/types'
import { toTriggerMaxDurationSeconds } from '@/lib/core/execution-limits'
import { generateRequestId } from '@/lib/core/utils/request'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { RESUME_EXECUTION_JOB_ID_PREFIX } from '@/lib/workflows/executor/enqueue-execution'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import {
  agentStreamProtocolResponseHeaders,
  createStreamingResponse,
} from '@/lib/workflows/streaming/streaming'
import { executeResumeJob, type ResumeExecutionPayload } from '@/background/resume-execution'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import { projectResolvedSecretDiagnosticError } from '@/executor/utils/resolved-secret-content-projection'

const logger = createLogger('WorkflowResumeAPI')

const INVALID_PAUSED_SNAPSHOT_ERROR = 'Paused execution snapshot is invalid'
const INVALID_PAUSED_ATTRIBUTION_ERROR =
  'Paused execution billing attribution is missing or invalid'
const PAUSED_EXECUTION_BINDING_ERROR =
  'Paused execution snapshot does not match the requested workflow or execution'
const PAUSED_ATTRIBUTION_BINDING_ERROR =
  'Paused execution billing attribution does not match its workspace or actor'

interface PausedExecutionSnapshotSource {
  workflowId: string
  executionId: string
  executionSnapshot: unknown
}

interface PausedExecutionSnapshotBinding {
  snapshot: ExecutionSnapshot
  billingAttribution: BillingAttributionSnapshot
}

interface HandleResumeExecutionOptions {
  request: NextRequest
  workflowId: string
  executionId: string
  contextId: string
  workspaceId: string
  userId: string
  resumeInput: unknown
  isApiCaller: boolean
  pollingSurface: 'legacy' | 'v2'
  /** When false, inherited stream-mode resumes use async JSON polling instead of SSE. */
  allowStreaming?: boolean
}

function loadPausedExecutionSnapshot(
  pausedExecution: PausedExecutionSnapshotSource,
  expected: { workflowId: string; executionId: string; workspaceId: string }
): PausedExecutionSnapshotBinding {
  if (
    !isRecordLike(pausedExecution.executionSnapshot) ||
    typeof pausedExecution.executionSnapshot.snapshot !== 'string'
  ) {
    throw new Error(INVALID_PAUSED_SNAPSHOT_ERROR)
  }

  let snapshot: ExecutionSnapshot
  try {
    snapshot = ExecutionSnapshot.fromJSON(pausedExecution.executionSnapshot.snapshot)
  } catch {
    throw new Error(INVALID_PAUSED_SNAPSHOT_ERROR)
  }

  if (!isRecordLike(snapshot.metadata)) {
    throw new Error(INVALID_PAUSED_SNAPSHOT_ERROR)
  }

  let billingAttribution: BillingAttributionSnapshot
  try {
    billingAttribution = assertBillingAttributionSnapshot(snapshot.metadata.billingAttribution)
  } catch {
    throw new Error(INVALID_PAUSED_ATTRIBUTION_ERROR)
  }

  if (
    pausedExecution.workflowId !== expected.workflowId ||
    pausedExecution.executionId !== expected.executionId ||
    snapshot.metadata.workflowId !== expected.workflowId ||
    snapshot.metadata.executionId !== expected.executionId
  ) {
    throw new Error(PAUSED_EXECUTION_BINDING_ERROR)
  }

  if (
    snapshot.metadata.workspaceId !== expected.workspaceId ||
    billingAttribution.workspaceId !== expected.workspaceId ||
    snapshot.metadata.userId !== billingAttribution.actorUserId
  ) {
    throw new Error(PAUSED_ATTRIBUTION_BINDING_ERROR)
  }

  return { snapshot, billingAttribution }
}

/** Executes the shared resume flow while preserving each API surface's polling contract. */
export async function handleResumeExecution({
  request,
  workflowId,
  executionId,
  contextId,
  workspaceId,
  userId,
  resumeInput,
  isApiCaller,
  pollingSurface,
  allowStreaming = true,
}: HandleResumeExecutionOptions): Promise<NextResponse> {
  const requestId = generateRequestId()
  const pausedExecution = await PauseResumeManager.getPausedExecutionDetail({
    workflowId,
    executionId,
  })
  if (!pausedExecution) {
    return NextResponse.json({ error: 'Paused execution not found' }, { status: 404 })
  }

  let snapshotBinding: PausedExecutionSnapshotBinding
  try {
    snapshotBinding = loadPausedExecutionSnapshot(pausedExecution, {
      workflowId,
      executionId,
      workspaceId,
    })
  } catch (error) {
    const message = toError(error).message
    logger.error(`[${requestId}] Failed to validate paused execution snapshot`, {
      workflowId,
      executionId,
      error: message,
    })
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const { snapshot: persistedSnapshot, billingAttribution } = snapshotBinding
  const resumeExecutionId = generateId()

  logger.info(`[${requestId}] Preprocessing resume execution`, {
    workflowId,
    parentExecutionId: executionId,
    resumeExecutionId,
    userId,
    actorUserId: billingAttribution.actorUserId,
  })

  /**
   * This preflight gives synchronous callers current block/usage feedback
   * without reserving under a throwaway id. The claimed resume reruns every
   * gate and reserves atomically under its persisted resume execution id.
   */
  const preprocessResult = await preprocessExecution({
    workflowId,
    userId,
    triggerType: 'manual',
    executionId: resumeExecutionId,
    requestId,
    checkRateLimit: false,
    checkDeployment: false,
    skipConcurrencyReservation: true,
    logPreprocessingErrors: false,
    workspaceId,
    billingAttribution,
  })

  if (!preprocessResult.success) {
    logger.warn(`[${requestId}] Preprocessing failed for resume`, {
      workflowId,
      parentExecutionId: executionId,
      error: preprocessResult.error?.message,
      statusCode: preprocessResult.error?.statusCode,
    })

    return NextResponse.json(
      {
        error:
          preprocessResult.error?.message ||
          'Failed to validate resume execution. Please try again.',
      },
      { status: preprocessResult.error?.statusCode || 400 }
    )
  }

  logger.info(`[${requestId}] Preprocessing passed, proceeding with resume`, {
    workflowId,
    parentExecutionId: executionId,
    resumeExecutionId,
    actorUserId: preprocessResult.actorUserId,
  })

  try {
    const enqueueResult = await PauseResumeManager.enqueueOrStartResume({
      executionId,
      workflowId,
      contextId,
      resumeInput,
      userId,
      allowedPauseKinds: ['human'],
    })

    if (enqueueResult.status === 'queued') {
      return NextResponse.json({
        status: 'queued',
        executionId: enqueueResult.resumeExecutionId,
        queuePosition: enqueueResult.queuePosition,
        message: 'Resume queued. It will run after current resumes finish.',
      })
    }

    const resumeArgs = {
      resumeEntryId: enqueueResult.resumeEntryId,
      resumeExecutionId: enqueueResult.resumeExecutionId,
      pausedExecution: enqueueResult.pausedExecution,
      contextId: enqueueResult.contextId,
      resumeInput: enqueueResult.resumeInput,
      userId: enqueueResult.userId,
    }

    const persistedExecutionMode = persistedSnapshot.metadata.executionMode ?? 'sync'
    const executionMode = isApiCaller
      ? persistedExecutionMode === 'stream' && !allowStreaming
        ? 'async'
        : persistedExecutionMode
      : undefined
    const includeThinking = persistedSnapshot.metadata.includeThinking === true
    const includeToolCalls = persistedSnapshot.metadata.includeToolCalls === true

    if (isApiCaller && executionMode === 'stream') {
      const stream = await createStreamingResponse({
        requestId,
        streamConfig: {
          selectedOutputs: persistedSnapshot.selectedOutputs,
          timeoutMs: preprocessResult.executionTimeout?.sync,
          includeThinking,
          includeToolCalls,
        },
        executionId: enqueueResult.resumeExecutionId,
        workspaceId,
        workflowId,
        userId: enqueueResult.userId,
        allowLargeValueWorkflowScope: true,
        requestSignal: request.signal,
        requestHeaders: request.headers,
        executeFn: async ({ onStream, onBlockComplete, abortSignal }) =>
          PauseResumeManager.startResumeExecution({
            ...resumeArgs,
            onStream,
            onBlockComplete,
            abortSignal,
          }),
      })

      return new NextResponse(stream, {
        headers: {
          ...SSE_HEADERS,
          ...agentStreamProtocolResponseHeaders({ requestHeaders: request.headers }),
          'X-Execution-Id': enqueueResult.resumeExecutionId,
        },
      })
    }

    if (isApiCaller && executionMode === 'sync') {
      const result = await PauseResumeManager.startResumeExecution(resumeArgs)

      return NextResponse.json({
        success: result.success,
        status: result.status ?? (result.success ? 'completed' : 'failed'),
        executionId: enqueueResult.resumeExecutionId,
        output: result.output,
        error: result.error,
        metadata: result.metadata
          ? {
              duration: result.metadata.duration,
              startTime: result.metadata.startTime,
              endTime: result.metadata.endTime,
            }
          : undefined,
      })
    }

    if (isApiCaller && executionMode === 'async') {
      const correlation: AsyncExecutionCorrelation = {
        executionId,
        requestId,
        source: 'workflow',
        workflowId,
        triggerType: 'resume',
      }
      const resumePayload: ResumeExecutionPayload = {
        resumeEntryId: enqueueResult.resumeEntryId,
        resumeExecutionId: enqueueResult.resumeExecutionId,
        pausedExecutionId: enqueueResult.pausedExecution.id,
        contextId: enqueueResult.contextId,
        resumeInput: enqueueResult.resumeInput,
        userId: enqueueResult.userId,
        workflowId,
        parentExecutionId: executionId,
        executionTimeoutMs: preprocessResult.executionTimeout.async,
        billingAttribution: preprocessResult.billingAttribution,
      }

      let jobId: string
      try {
        const jobQueue = await getJobQueue()
        const executeInline = shouldExecuteInline()
        jobId = await jobQueue.enqueue('resume-execution', resumePayload, {
          ...(pollingSurface === 'v2'
            ? { jobId: `${RESUME_EXECUTION_JOB_ID_PREFIX}${enqueueResult.resumeEntryId}` }
            : {}),
          metadata: {
            executionId,
            workflowId,
            workspaceId,
            userId,
            resumeExecutionId: enqueueResult.resumeExecutionId,
            correlation,
          },
          maxDurationSeconds: toTriggerMaxDurationSeconds(preprocessResult.executionTimeout.async),
          ...(executeInline
            ? {
                runner: (_queuedPayload: unknown, signal: AbortSignal) =>
                  executeResumeJob(resumePayload, signal),
              }
            : {}),
        })
        logger.info('Enqueued async resume execution', {
          jobId,
          resumeExecutionId: enqueueResult.resumeExecutionId,
        })
      } catch (dispatchError) {
        logger.error('Failed to dispatch async resume execution', {
          error: toError(dispatchError).message,
          resumeExecutionId: enqueueResult.resumeExecutionId,
        })
        await PauseResumeManager.markResumeAttemptFailed({
          resumeEntryId: enqueueResult.resumeEntryId,
          pausedExecutionId: enqueueResult.pausedExecution.id,
          parentExecutionId: executionId,
          contextId: enqueueResult.contextId,
          failureReason: 'Failed to queue async resume execution',
        })
        await PauseResumeManager.processQueuedResumes(executionId, workflowId)
        return NextResponse.json(
          { error: 'Failed to queue resume execution. Please try again.' },
          { status: 503 }
        )
      }

      return NextResponse.json(
        {
          success: true,
          async: true,
          ...(pollingSurface === 'legacy' ? { jobId } : {}),
          executionId: enqueueResult.resumeExecutionId,
          message: 'Resume execution queued',
          statusUrl:
            pollingSurface === 'legacy'
              ? `${getBaseUrl()}/api/jobs/${jobId}`
              : `${getBaseUrl()}/api/v2/workflows/${workflowId}/runs/${enqueueResult.resumeExecutionId}`,
        },
        { status: 202 }
      )
    }

    PauseResumeManager.startResumeExecution(resumeArgs).catch((error) => {
      logger.error(
        'Failed to start resume execution',
        projectResolvedSecretDiagnosticError(error, undefined, {
          workflowId,
          parentExecutionId: executionId,
          resumeExecutionId: enqueueResult.resumeExecutionId,
        })
      )
    })

    return NextResponse.json({
      status: 'started',
      executionId: enqueueResult.resumeExecutionId,
      message: 'Resume execution started.',
    })
  } catch (error) {
    logger.error(
      'Resume request failed',
      projectResolvedSecretDiagnosticError(error, undefined, {
        workflowId,
        executionId,
        contextId,
      })
    )
    const statusCode =
      isRecordLike(error) && typeof error.statusCode === 'number' ? error.statusCode : 400
    return NextResponse.json(
      { error: toError(error).message || 'Failed to queue resume request' },
      { status: statusCode }
    )
  }
}
