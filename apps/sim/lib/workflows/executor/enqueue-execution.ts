import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { releaseExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { getJobQueue, shouldExecuteInline } from '@/lib/core/async-jobs'
import { isAsyncJobEnqueueError } from '@/lib/core/async-jobs/types'
import { toTriggerMaxDurationSeconds } from '@/lib/core/execution-limits'
import { WORKFLOW_EXECUTION_JOB_ID_PREFIX } from '@/lib/workflows/executor/execution-job-ids'
import { executeWorkflowJob, type WorkflowExecutionPayload } from '@/background/workflow-execution'
import type { ResolvedSecretTraceProvenanceV1 } from '@/executor/utils/resolved-secret-trace-registry'
import type { CoreTriggerType } from '@/stores/logs/filters/types'

const logger = createLogger('WorkflowEnqueueExecution')

const ASYNC_ENQUEUE_ATTEMPTS = 2

export {
  RESUME_EXECUTION_JOB_ID_PREFIX,
  WORKFLOW_EXECUTION_JOB_ID_PREFIX,
} from '@/lib/workflows/executor/execution-job-ids'

export interface EnqueueWorkflowExecutionParams {
  requestId: string
  workflowId: string
  userId: string
  billingAttribution: BillingAttributionSnapshot
  workspaceId: string
  input: unknown
  triggerType: CoreTriggerType
  triggerBlockId?: string
  executionId: string
  copilotToolCallId?: string
  callChain?: string[]
  executionTimeoutMs: number
  trustedInitialResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
  /** Identity decisions the enqueuing surface made; the worker cannot re-derive them. */
  enforceCredentialAccess?: boolean
  isPublicApiAccess?: boolean
}

/**
 * Outcome of an async enqueue attempt. Slot/claim semantics are encoded here,
 * not in HTTP statuses (which are ambiguous — a 503 can mean five different
 * things on the execute surface):
 * - `queued`: the job holds the execution slot (`admissionCompleted: true`) and
 *   the execution-id claim must be RETAINED — the worker writes the durable log
 *   row under that id.
 * - `rejected`: the queue definitively refused; the slot was released here and
 *   the claim must be released by the caller.
 * - `ambiguous`: acceptance is unknown — a job may exist, so NEITHER the slot
 *   nor the claim may be released (releasing would double-free under a live
 *   job); the slot leaks to TTL only if the job genuinely never landed.
 */
export type EnqueueWorkflowExecutionResult =
  | { outcome: 'queued'; jobId: string; executionId: string; retainExecutionClaim: true }
  | { outcome: 'rejected'; executionId: string; retainExecutionClaim: false }
  | { outcome: 'ambiguous'; executionId: string; retainExecutionClaim: true }

/**
 * Enqueues an async workflow execution. The caller must have already admitted,
 * claimed the execution id, and reserved the execution slot (via
 * `preprocessExecution`); the enqueued job inherits that reservation.
 * Shared by the v1 and v2 execute routes so retry, acceptance classification,
 * and inline-execution dispatch can never drift between surfaces.
 */
export async function enqueueWorkflowExecution(
  params: EnqueueWorkflowExecutionParams
): Promise<EnqueueWorkflowExecutionResult> {
  const {
    requestId,
    workflowId,
    userId,
    billingAttribution,
    workspaceId,
    input,
    triggerType,
    triggerBlockId,
    executionId,
    copilotToolCallId,
    callChain,
    executionTimeoutMs,
    trustedInitialResolvedSecretTraceProvenance,
    enforceCredentialAccess,
    isPublicApiAccess,
  } = params
  const asyncLogger = logger.withMetadata({
    requestId,
    workflowId,
    workspaceId,
    userId,
    executionId,
  })

  const correlation = {
    executionId,
    requestId,
    source: 'workflow' as const,
    workflowId,
    ...(copilotToolCallId ? { copilotToolCallId } : {}),
    triggerType,
  }

  const payload: WorkflowExecutionPayload = {
    workflowId,
    userId,
    billingAttribution,
    workspaceId,
    input,
    triggerType,
    triggerBlockId,
    executionId,
    requestId,
    correlation,
    callChain,
    enforceCredentialAccess,
    isPublicApiAccess,
    executionMode: 'async',
    admissionCompleted: true,
    executionTimeoutMs,
    trustedInitialResolvedSecretTraceProvenance,
  }

  let jobQueue: Awaited<ReturnType<typeof getJobQueue>>
  try {
    jobQueue = await getJobQueue()
  } catch (error) {
    asyncLogger.error('Failed to initialize async execution queue', {
      error: toError(error).message,
    })
    await releaseExecutionSlot(executionId)
    return { outcome: 'rejected', executionId, retainExecutionClaim: false }
  }

  const deterministicJobId = `${WORKFLOW_EXECUTION_JOB_ID_PREFIX}${executionId}`
  const executeInline = shouldExecuteInline()
  const enqueueOptions = {
    jobId: deterministicJobId,
    metadata: { workflowId, workspaceId, userId, correlation },
    maxDurationSeconds: toTriggerMaxDurationSeconds(executionTimeoutMs),
    ...(executeInline
      ? {
          runner: (_queuedPayload: unknown, signal: AbortSignal) =>
            executeWorkflowJob(payload, signal),
        }
      : {}),
  }
  let jobId: string | undefined
  let enqueueError: unknown
  let acceptanceCouldBeUnknown = false

  for (let attempt = 1; attempt <= ASYNC_ENQUEUE_ATTEMPTS; attempt++) {
    try {
      jobId = await jobQueue.enqueue('workflow-execution', payload, enqueueOptions)
      enqueueError = undefined
      break
    } catch (error) {
      enqueueError = error
      const classifiedError = isAsyncJobEnqueueError(error) ? error : undefined
      const attemptAcceptance = classifiedError?.acceptance ?? 'unknown'
      acceptanceCouldBeUnknown ||= attemptAcceptance === 'unknown'
      asyncLogger.warn('Async workflow enqueue attempt failed', {
        acceptance: attemptAcceptance,
        attempt,
        error: toError(error).message,
        jobId: deterministicJobId,
      })
      if (classifiedError?.retryable === false || attempt === ASYNC_ENQUEUE_ATTEMPTS) {
        break
      }
    }
  }

  if (!jobId) {
    const acceptance = acceptanceCouldBeUnknown
      ? 'unknown'
      : isAsyncJobEnqueueError(enqueueError)
        ? enqueueError.acceptance
        : 'unknown'
    asyncLogger.error('Failed to queue async execution', {
      acceptance,
      error: toError(enqueueError).message,
      jobId: deterministicJobId,
    })

    if (acceptance === 'rejected') {
      await releaseExecutionSlot(executionId)
      return { outcome: 'rejected', executionId, retainExecutionClaim: false }
    }

    return { outcome: 'ambiguous', executionId, retainExecutionClaim: true }
  }

  asyncLogger.info('Queued async workflow execution', { jobId })

  return { outcome: 'queued', jobId, executionId, retainExecutionClaim: true }
}
