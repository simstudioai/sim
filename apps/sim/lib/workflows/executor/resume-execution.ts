import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import { getJobQueue, shouldExecuteInline } from '@/lib/core/async-jobs'
import type { AsyncExecutionCorrelation } from '@/lib/core/async-jobs/types'
import { toTriggerMaxDurationSeconds } from '@/lib/core/execution-limits'
import { generateRequestId } from '@/lib/core/utils/request'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { RESUME_EXECUTION_JOB_ID_PREFIX } from '@/lib/workflows/executor/enqueue-execution'
import { PauseResumeManager } from '@/lib/workflows/executor/human-in-the-loop-manager'
import { createStreamingResponse } from '@/lib/workflows/streaming/streaming'
import { executeResumeJob, type ResumeExecutionPayload } from '@/background/resume-execution'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import { projectResolvedSecretDiagnosticError } from '@/executor/utils/resolved-secret-content-projection'

const logger = createLogger('WorkflowResumeExecution')

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

export interface ExecuteResumeWorkflowOptions {
  workflowId: string
  executionId: string
  contextId: string
  workspaceId: string
  userId: string
  resumeInput: unknown
  isApiCaller: boolean
  pollingSurface: 'legacy' | 'v2'
  allowStreaming?: boolean
  requestSignal?: AbortSignal
  requestHeaders?: Headers
}

export type ResumeWorkflowExecutionResult =
  | {
      kind: 'queued'
      executionId: string
      queuePosition: number
    }
  | {
      kind: 'stream'
      executionId: string
      stream: ReadableStream
    }
  | {
      kind: 'sync'
      executionId: string
      success: boolean
      status: string
      output: unknown
      error: unknown
      metadata?: {
        duration?: number
        startTime?: string
        endTime?: string
      }
    }
  | {
      kind: 'async'
      executionId: string
      jobId: string
    }
  | {
      kind: 'started'
      executionId: string
    }

export class ResumeWorkflowExecutionError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly safeForPublicApi: boolean
  ) {
    super(message)
    this.name = 'ResumeWorkflowExecutionError'
  }
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

/** Executes a resume transition without coupling application behavior to an HTTP response. */
export async function executeResumeWorkflow({
  workflowId,
  executionId,
  contextId,
  workspaceId,
  userId,
  resumeInput,
  isApiCaller,
  pollingSurface,
  allowStreaming = true,
  requestSignal,
  requestHeaders,
}: ExecuteResumeWorkflowOptions): Promise<ResumeWorkflowExecutionResult> {
  const requestId = generateRequestId()
  const pausedExecution = await PauseResumeManager.getPausedExecutionDetail({
    workflowId,
    executionId,
  })
  if (!pausedExecution) {
    throw new ResumeWorkflowExecutionError(404, 'Paused execution not found', true)
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
    throw new ResumeWorkflowExecutionError(500, message, false)
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
    const statusCode = preprocessResult.error?.statusCode || 400
    const message =
      preprocessResult.error?.message || 'Failed to validate resume execution. Please try again.'
    logger.warn(`[${requestId}] Preprocessing failed for resume`, {
      workflowId,
      parentExecutionId: executionId,
      error: message,
      statusCode,
    })
    throw new ResumeWorkflowExecutionError(statusCode, message, statusCode < 500)
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
      return {
        kind: 'queued',
        executionId: enqueueResult.resumeExecutionId,
        queuePosition: enqueueResult.queuePosition,
      }
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

    if (isApiCaller && executionMode === 'stream') {
      if (!requestSignal || !requestHeaders) {
        throw new Error('Streaming resume execution requires request signal and headers')
      }
      const stream = await createStreamingResponse({
        requestId,
        streamConfig: {
          selectedOutputs: persistedSnapshot.selectedOutputs,
          timeoutMs: preprocessResult.executionTimeout?.sync,
          includeThinking: persistedSnapshot.metadata.includeThinking === true,
          includeToolCalls: persistedSnapshot.metadata.includeToolCalls === true,
        },
        executionId: enqueueResult.resumeExecutionId,
        workspaceId,
        workflowId,
        userId: enqueueResult.userId,
        allowLargeValueWorkflowScope: true,
        requestSignal,
        requestHeaders,
        executeFn: async ({ onStream, onBlockComplete, abortSignal }) =>
          PauseResumeManager.startResumeExecution({
            ...resumeArgs,
            onStream,
            onBlockComplete: (blockId, data) =>
              onBlockComplete(blockId, data.output, data.outputBlockId),
            abortSignal,
          }),
      })
      return { kind: 'stream', executionId: enqueueResult.resumeExecutionId, stream }
    }

    if (isApiCaller && executionMode === 'sync') {
      const result = await PauseResumeManager.startResumeExecution(resumeArgs)
      return {
        kind: 'sync',
        executionId: enqueueResult.resumeExecutionId,
        success: result.success,
        status: result.status ?? (result.success ? 'completed' : 'failed'),
        output: result.output,
        error: result.error,
        metadata: result.metadata
          ? {
              duration: result.metadata.duration,
              startTime: result.metadata.startTime,
              endTime: result.metadata.endTime,
            }
          : undefined,
      }
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
      } catch (error) {
        logger.error('Failed to dispatch async resume execution', {
          error: toError(error).message,
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
        throw new ResumeWorkflowExecutionError(
          503,
          'Failed to queue resume execution. Please try again.',
          true
        )
      }

      return { kind: 'async', executionId: enqueueResult.resumeExecutionId, jobId }
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
    return { kind: 'started', executionId: enqueueResult.resumeExecutionId }
  } catch (error) {
    if (error instanceof ResumeWorkflowExecutionError) throw error
    logger.error(
      'Resume request failed',
      projectResolvedSecretDiagnosticError(error, undefined, {
        workflowId,
        executionId,
        contextId,
      })
    )
    const statusCode =
      isRecordLike(error) && typeof error.statusCode === 'number' ? error.statusCode : undefined
    if (statusCode !== undefined) {
      throw new ResumeWorkflowExecutionError(statusCode, toError(error).message, statusCode < 500)
    }
    throw error
  }
}
