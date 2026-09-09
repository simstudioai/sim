import type { WorkflowExecutionPrincipal } from '@sim/auth/principal'
import type { workflow as workflowTable } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { BlockState } from '@sim/workflow-types/workflow'
import { releaseExecutionSlot } from '@/lib/billing/calculations/usage-reservation'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { createTimeoutAbortController, getTimeoutErrorMessage } from '@/lib/core/execution-limits'
import { SSE_HEADERS } from '@/lib/core/utils/sse'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { validateCallChain } from '@/lib/execution/call-chain'
import { processInputFileFields } from '@/lib/execution/files'
import { containsLargeValueRef } from '@/lib/execution/payloads/large-value-ref'
import { compactExecutionPayload } from '@/lib/execution/payloads/serializer'
import { preprocessExecution } from '@/lib/execution/preprocessing'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { MAX_MCP_WORKFLOW_RESPONSE_BYTES } from '@/lib/mcp/constants'
import { hydrateUserFilesWithBase64 } from '@/lib/uploads/utils/user-file-base64.server'
import { getCustomBlockRowsForWorkspace } from '@/lib/workflows/custom-blocks/operations'
import { enqueueWorkflowExecution } from '@/lib/workflows/executor/enqueue-execution'
import { executeWorkflow } from '@/lib/workflows/executor/execute-workflow'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import {
  claimExecutionId,
  type ExecutionIdClaim,
  hasDurableExecutionOwner,
  releaseExecutionIdClaim,
} from '@/lib/workflows/executor/execution-id-claim'
import { handlePostExecutionPauseState } from '@/lib/workflows/executor/pause-persistence'
import {
  loadDeployedWorkflowState,
  loadWorkflowDeploymentVersionState,
  loadWorkflowFromNormalizedTables,
} from '@/lib/workflows/persistence/utils'
import { shouldEmitAgentStreamEvents } from '@/lib/workflows/streaming/agent-stream-protocol'
import { resolveOutputSelectors } from '@/lib/workflows/streaming/resolve-output-selectors'
import {
  agentStreamProtocolResponseHeaders,
  createStreamingResponse,
} from '@/lib/workflows/streaming/streaming'
import { workflowHasResponseBlock } from '@/lib/workflows/utils'
import { withCustomBlockOverlay } from '@/blocks/custom/server-overlay'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type { ExecutionMetadata, SerializableExecutionState } from '@/executor/execution/types'
import type { NormalizedBlockOutput } from '@/executor/types'
import {
  classifyExecutionError,
  hasExecutionResult,
  type StructuredExecutionError,
} from '@/executor/utils/errors'
import type { ResolvedSecretTraceProvenanceV1 } from '@/executor/utils/resolved-secret-trace-registry'
import { Serializer } from '@/serializer'
import type { CoreTriggerType } from '@/stores/logs/filters/types'

const logger = createLogger('WorkflowExecuteService')

const EXECUTION_ID_CLAIM_ATTEMPTS = 3

type WorkflowRecord = typeof workflowTable.$inferSelect

/**
 * Sync workflow execution as a callable service — the orchestration the v1
 * execute route holds inline (call-chain guard, execution-id claim,
 * LoggingSession, preprocessing/billing, deployed-state load, file-field
 * processing, timeout-bound core execution, output compaction), composed from
 * the same libs, for v2 and in-process internal callers (MCP bridge). Manual and
 * entry-point controls are trusted, server-derived options; HTTP callers never
 * supply executor state or snapshots directly.
 */
export interface ExecuteWorkflowServiceParams {
  workflowId: string
  principal: WorkflowExecutionPrincipal
  /** Authenticated user driving actor resolution in preprocessing. */
  userId: string
  input: unknown
  /** Server-derived caller class — never a wire field. */
  triggerType: CoreTriggerType
  requestId: string
  /** Caller-supplied idempotent execution id; a reused id fails with `conflict`. */
  executionId?: string
  callChain?: string[]
  useAuthenticatedUserAsActor?: boolean
  /** Anonymous public-API run (see {@link ExecutionMetadata.isPublicApiAccess}). */
  isPublicApiAccess?: boolean
  /** Pre-fetched workflow row (already authorized by the caller). */
  workflowRecord?: WorkflowRecord
  upstreamBillingAttribution?: BillingAttributionSnapshot
  /** Pin execution to a specific deployment version (MCP bridge). */
  deploymentVersionId?: string
  includeFileBase64?: boolean
  base64MaxBytes?: number
  selectedOutputs?: string[]
  /** MCP behavior: 413-style failure instead of large-value refs in output. */
  rejectLargeInlineOutput?: boolean
  /** Which rate-limit bucket preprocessing debits. */
  rateLimitCounter?: 'sync' | 'async'
  /** Optional caller-requested async cap in seconds, bounded by preprocessing policy. */
  requestedTimeoutSeconds?: number
  /** Outer request signal; aborting cancels the run (client disconnect). */
  abortSignal?: AbortSignal
  /**
   * `sync` (default): run to completion and return the result resource.
   * `async`: enqueue and return the queue receipt.
   * `stream`: return an SSE Response (agent-stream protocol negotiated from
   * `requestHeaders`).
   * `sync-result-stream`: start the same work as `sync` and return its pending
   * result so an HTTP surface can emit transport heartbeats while it runs.
   */
  mode?: 'sync' | 'async' | 'stream' | 'sync-result-stream'
  /** Original request headers — stream-protocol negotiation only. */
  requestHeaders?: Headers
  includeThinking?: boolean
  includeToolCalls?: boolean
  /** Execute the current saved state manually instead of the active deployment. */
  useDraftState?: boolean
  /** Explicit trigger entry point selected and validated by the application use case. */
  triggerBlockId?: string
  /** Trusted prior-run snapshot resolved by the application use case. */
  runFromBlock?: {
    startBlockId: string
    sourceSnapshot: SerializableExecutionState
    sourceExecutionId: string
  }
}

export interface ExecuteWorkflowServiceFailure {
  kind: 'precheck' | 'conflict' | 'input' | 'aborted' | 'output_too_large' | 'infra'
  message: string
  statusCode: number
  code?: string
  retryAfterMs?: number
  /** Present when an execution identity was already minted (conflict/ambiguous cases). */
  executionId?: string
}

export interface ExecuteWorkflowServiceRun {
  ok: true
  executionId: string
  workflowId: string
  status: 'completed' | 'failed' | 'paused' | 'cancelled'
  /** Why a `cancelled`/`failed` terminal state occurred, when signal-driven. */
  aborted: 'client' | 'timeout' | null
  output: NormalizedBlockOutput | undefined
  error: StructuredExecutionError | null
  /** Trusted execution-local catalog used by internal callers to project model-visible output. */
  resolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
  hasResponseBlock: boolean
  startedAt?: string
  endedAt?: string
  durationMs?: number
}

export interface ExecuteWorkflowServiceQueued {
  ok: true
  queued: true
  executionId: string
  jobId: string
}

export interface ExecuteWorkflowServiceStream {
  ok: true
  stream: Response
  executionId: string
}

/**
 * A prepared synchronous run that a streaming surface can present while the
 * exact same execution promise used by `sync` is pending.
 */
export interface ExecuteWorkflowServicePendingRun {
  ok: true
  executionId: string
  pending: Promise<ExecuteWorkflowServiceTerminalResult>
  cancel: () => void
}

export interface ExecuteWorkflowServiceFailureResult {
  ok: false
  failure: ExecuteWorkflowServiceFailure
}

export type ExecuteWorkflowServiceTerminalResult =
  | ExecuteWorkflowServiceRun
  | ExecuteWorkflowServiceFailureResult

export type ExecuteWorkflowServiceResult =
  | ExecuteWorkflowServiceTerminalResult
  | ExecuteWorkflowServiceQueued
  | ExecuteWorkflowServiceStream
  | ExecuteWorkflowServicePendingRun

export type ExecuteWorkflowServiceImmediateResult = Exclude<
  ExecuteWorkflowServiceResult,
  ExecuteWorkflowServicePendingRun
>

function failure(f: ExecuteWorkflowServiceFailure): ExecuteWorkflowServiceFailureResult {
  return { ok: false, failure: f }
}

async function compactServiceOutput<T>(
  value: T,
  context: {
    workspaceId: string
    workflowId: string
    executionId: string
    userId: string
    rejectLargeInlineOutput: boolean
  }
): Promise<T> {
  const compacted = await compactExecutionPayload(value, {
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    executionId: context.executionId,
    userId: context.userId,
    preserveUserFileBase64: true,
    preserveRoot: !context.rejectLargeInlineOutput,
    rejectLargeValues: context.rejectLargeInlineOutput,
    rejectLargeValueLabel: 'Workflow execution response',
    thresholdBytes: context.rejectLargeInlineOutput ? MAX_MCP_WORKFLOW_RESPONSE_BYTES : undefined,
    requireDurable: true,
  })

  if (context.rejectLargeInlineOutput && containsLargeValueRef(compacted)) {
    throw new PayloadSizeLimitError({
      label: 'Workflow execution response',
      maxBytes: MAX_MCP_WORKFLOW_RESPONSE_BYTES,
      observedBytes: MAX_MCP_WORKFLOW_RESPONSE_BYTES + 1,
    })
  }

  return compacted
}

export function executeWorkflowService(
  params: ExecuteWorkflowServiceParams & { mode: 'sync-result-stream' }
): Promise<ExecuteWorkflowServicePendingRun | ExecuteWorkflowServiceFailureResult>
export function executeWorkflowService(
  params: ExecuteWorkflowServiceParams & { mode?: 'sync' | 'async' | 'stream' }
): Promise<ExecuteWorkflowServiceImmediateResult>
export function executeWorkflowService(
  params: ExecuteWorkflowServiceParams
): Promise<ExecuteWorkflowServiceResult>
export async function executeWorkflowService(
  params: ExecuteWorkflowServiceParams
): Promise<ExecuteWorkflowServiceResult> {
  const {
    workflowId,
    principal,
    userId,
    input,
    triggerType,
    requestId,
    callChain,
    useAuthenticatedUserAsActor = false,
    isPublicApiAccess = false,
    workflowRecord,
    upstreamBillingAttribution,
    deploymentVersionId,
    includeFileBase64 = true,
    base64MaxBytes,
    selectedOutputs = [],
    rejectLargeInlineOutput = false,
    rateLimitCounter = 'sync',
    requestedTimeoutSeconds,
    abortSignal,
    mode = 'sync',
    requestHeaders,
    includeThinking = false,
    includeToolCalls = false,
    useDraftState = false,
    triggerBlockId,
    runFromBlock,
  } = params

  let reqLogger = logger.withMetadata({ requestId, workflowId, userId })

  if (useDraftState && mode === 'async') {
    return failure({
      kind: 'precheck',
      message: 'Manual execution does not support async mode',
      statusCode: 400,
    })
  }
  if (useDraftState && deploymentVersionId) {
    throw new Error('Manual execution cannot be pinned to a deployment version')
  }
  if (runFromBlock && !useDraftState) {
    throw new Error('Run-from-block requires manual execution state')
  }

  if (callChain) {
    const chainError = validateCallChain(callChain)
    if (chainError) {
      return failure({ kind: 'precheck', message: chainError, statusCode: 409 })
    }
  }

  const callerProvidedExecutionId = Boolean(params.executionId)
  let executionId = params.executionId ?? generateId()
  reqLogger = reqLogger.withMetadata({ executionId })

  let executionIdClaim: ExecutionIdClaim | null = null
  let executionIdClaimCommitted = false
  let executionIdClaimTransferred = false

  const settleExecutionIdClaim = async () => {
    if (!executionIdClaim || executionIdClaimCommitted) return

    try {
      executionIdClaimCommitted = await hasDurableExecutionOwner(executionId)
    } catch (error) {
      executionIdClaimCommitted = true
      reqLogger.warn('Unable to verify execution ID ownership; retaining claim', {
        error: toError(error).message,
        executionId,
      })
    }

    if (executionIdClaimCommitted) return
    try {
      await releaseExecutionIdClaim(executionIdClaim)
      executionIdClaim = null
    } catch (error) {
      reqLogger.warn('Failed to release pre-start execution ID claim', {
        error: toError(error).message,
        executionId,
      })
    }
  }

  try {
    try {
      for (let attempt = 1; attempt <= EXECUTION_ID_CLAIM_ATTEMPTS; attempt++) {
        executionIdClaim = await claimExecutionId(executionId)
        if (executionIdClaim || callerProvidedExecutionId) break
        if (attempt < EXECUTION_ID_CLAIM_ATTEMPTS) {
          executionId = generateId()
          reqLogger = reqLogger.withMetadata({ executionId })
        }
      }
    } catch (error) {
      reqLogger.error('Failed to claim workflow execution ID', {
        error: getErrorMessage(error),
      })
      return failure({
        kind: 'infra',
        message: 'Workflow execution identity is temporarily unavailable',
        statusCode: 503,
      })
    }

    if (!executionIdClaim) {
      if (callerProvidedExecutionId) {
        return failure({
          kind: 'conflict',
          message: 'Execution ID has already been used',
          statusCode: 409,
          code: 'EXECUTION_ID_CONFLICT',
          executionId,
        })
      }
      reqLogger.error('Failed to allocate a unique server execution ID')
      return failure({
        kind: 'infra',
        message: 'Unable to allocate workflow execution identity',
        statusCode: 503,
      })
    }

    const loggingSession = new LoggingSession(workflowId, executionId, triggerType, requestId)

    const preprocessResult = await preprocessExecution({
      workflowId,
      userId,
      triggerType,
      executionId,
      requestId,
      checkDeployment: !useDraftState,
      rateLimitCounter,
      loggingSession,
      useAuthenticatedUserAsActor,
      workflowRecord,
      billingAttribution: upstreamBillingAttribution,
      executionType: mode === 'async' ? 'async' : 'sync',
      requestedTimeoutSeconds,
    })

    if (!preprocessResult.success) {
      const preprocessError = preprocessResult.error
      return failure({
        kind: 'precheck',
        message: preprocessError.message,
        statusCode: preprocessError.statusCode,
        code: preprocessError.code,
        retryAfterMs: preprocessError.retryAfterMs,
      })
    }

    // Preprocessing reserved an admission slot (released when the LoggingSession
    // finalizes). Any path that exits before execution starts must release it
    // here, or the slot leaks until its TTL and wrongly throttles later runs.
    if (abortSignal?.aborted) {
      await releaseExecutionSlot(executionId)
      return failure({ kind: 'aborted', message: 'Client cancelled request', statusCode: 499 })
    }

    const actorUserId = preprocessResult.actorUserId
    const workflow = preprocessResult.workflowRecord
    const billingAttribution = preprocessResult.billingAttribution
    const workspaceId = workflow.workspaceId
    if (!workspaceId) {
      await releaseExecutionSlot(executionId)
      return failure({
        kind: 'infra',
        message: 'Invalid execution context returned by preprocessing',
        statusCode: 500,
      })
    }
    reqLogger = reqLogger.withMetadata({ workspaceId, userId: actorUserId })

    if (mode === 'async') {
      const enqueue = await enqueueWorkflowExecution({
        requestId,
        workflowId,
        principal,
        userId: actorUserId,
        billingAttribution,
        workspaceId,
        input,
        triggerType,
        executionId,
        callChain,
        enforceCredentialAccess: useAuthenticatedUserAsActor,
        isPublicApiAccess,
        executionTimeoutMs: preprocessResult.executionTimeout.async,
      })
      executionIdClaimCommitted = enqueue.retainExecutionClaim
      if (enqueue.outcome === 'rejected') {
        return failure({
          kind: 'infra',
          message: 'Failed to queue async execution',
          statusCode: 500,
        })
      }
      if (enqueue.outcome === 'ambiguous') {
        return failure({
          kind: 'infra',
          message: 'Async execution queue acceptance could not be confirmed',
          statusCode: 503,
          code: 'ASYNC_ENQUEUE_AMBIGUOUS',
          executionId,
        })
      }
      return { ok: true, queued: true, executionId, jobId: enqueue.jobId }
    }

    let processedInput = input
    let workflowVariables: Record<string, unknown> = {}
    let workflowBlocks: Record<string, unknown> = {}
    try {
      const workflowData = useDraftState
        ? await loadWorkflowFromNormalizedTables(workflowId)
        : deploymentVersionId
          ? await loadWorkflowDeploymentVersionState(workflowId, deploymentVersionId, workspaceId)
          : await loadDeployedWorkflowState(workflowId, workspaceId)

      if (useDraftState && !workflowData) {
        await releaseExecutionSlot(executionId)
        return failure({
          kind: 'input',
          message: `Workflow ${workflowId} has no saved state to run manually`,
          statusCode: 400,
        })
      }

      if (abortSignal?.aborted) {
        await releaseExecutionSlot(executionId)
        return failure({ kind: 'aborted', message: 'Client cancelled request', statusCode: 499 })
      }

      if (workflowData) {
        workflowBlocks = workflowData.blocks
        workflowVariables =
          ('variables' in workflowData
            ? (workflowData.variables as Record<string, unknown> | undefined)
            : undefined) ??
          (workflow.variables as Record<string, unknown> | null) ??
          {}

        // Custom blocks resolve only inside the org overlay; wrap this pre-execution
        // serialize (used for input file-field discovery) the same way the core does.
        const customBlockRows = await getCustomBlockRowsForWorkspace(workspaceId)
        const serializedWorkflow = await withCustomBlockOverlay(customBlockRows, async () =>
          new Serializer().serializeWorkflow(
            workflowData.blocks,
            workflowData.edges,
            workflowData.loops || {},
            workflowData.parallels || {},
            false
          )
        )

        processedInput = await processInputFileFields(
          input,
          serializedWorkflow.blocks,
          { workspaceId, workflowId, executionId },
          requestId,
          actorUserId
        )
      } else {
        workflowVariables = (workflow.variables as Record<string, unknown> | null) ?? {}
      }
    } catch (fileError) {
      reqLogger.error('Failed to process input file fields', { error: fileError })
      executionIdClaimCommitted = await loggingSession.safeStart({
        userId: actorUserId,
        billingAttribution,
        workspaceId,
        variables: {},
      })
      await loggingSession.safeCompleteWithError({
        error: {
          message: `File processing failed: ${getErrorMessage(fileError, 'Unable to process input files')}`,
          stackTrace: fileError instanceof Error ? fileError.stack : undefined,
        },
        traceSpans: [],
      })
      return failure({
        kind: 'input',
        message: `File processing failed: ${getErrorMessage(fileError, 'Unable to process input files')}`,
        statusCode: 400,
      })
    }

    if (mode === 'stream') {
      let resolvedSelectedOutputs: string[] | undefined
      try {
        resolvedSelectedOutputs = await resolveOutputIds(selectedOutputs, workflowBlocks)
      } catch (error) {
        await releaseExecutionSlot(executionId)
        return failure({
          kind: 'input',
          message: `Invalid selectedOutputs: ${getErrorMessage(error)}`,
          statusCode: 400,
        })
      }
      const streamWorkflow = {
        id: workflow.id,
        /**
         * The owner, not the actor: `executeWorkflow` reads this one field to set
         * `workflowUserId`, which is the personal-environment fallback for runs with
         * no identifiable caller. Passing the actor here made the streaming path
         * resolve the actor where the JSON path resolves the owner.
         */
        userId: workflow.userId,
        workspaceId,
        isDeployed: workflow.isDeployed,
        variables: workflowVariables,
      }
      const headers = requestHeaders ?? new Headers()
      const agentEvents = shouldEmitAgentStreamEvents({
        includeThinking,
        includeToolCalls,
        requestHeaders: headers,
      })

      const stream = await createStreamingResponse({
        requestId,
        streamConfig: {
          selectedOutputs: resolvedSelectedOutputs,
          isSecureMode: false,
          workflowTriggerType: 'api',
          includeFileBase64,
          base64MaxBytes,
          timeoutMs: preprocessResult.executionTimeout?.sync,
          includeThinking,
          includeToolCalls,
        },
        executionId,
        largeValueExecutionIds: [executionId],
        largeValueKeys: [],
        fileKeys: [],
        workspaceId,
        workflowId,
        userId: actorUserId,
        principal,
        allowLargeValueWorkflowScope: false,
        requestSignal: abortSignal,
        requestHeaders: headers,
        executeFn: async ({ onStream, onBlockComplete, abortSignal: streamAbortSignal }) =>
          executeWorkflow(
            streamWorkflow,
            requestId,
            processedInput,
            actorUserId,
            {
              enabled: true,
              selectedOutputs: resolvedSelectedOutputs,
              isSecureMode: false,
              workflowTriggerType: triggerType,
              triggerBlockId,
              useDraftState,
              runFromBlock,
              onStream,
              onBlockComplete: (blockId, data) =>
                onBlockComplete(blockId, data.output, data.outputBlockId),
              skipLoggingComplete: true,
              includeFileBase64,
              base64MaxBytes,
              abortSignal: streamAbortSignal,
              executionMode: 'stream',
              principal,
              enforceCredentialAccess: useAuthenticatedUserAsActor,
              isPublicApiAccess,
              billingAttribution,
              largeValueKeys: [],
              fileKeys: [],
              includeThinking,
              includeToolCalls,
              agentEvents,
            },
            executionId
          ),
      })

      executionIdClaimCommitted = true
      return {
        ok: true,
        executionId,
        stream: new Response(stream, {
          status: 200,
          headers: {
            ...SSE_HEADERS,
            // Echo the negotiated stream protocol (same as the chat and v1 routes).
            ...agentStreamProtocolResponseHeaders({ requestHeaders: headers }),
          },
        }),
      }
    }

    const metadata: ExecutionMetadata = {
      requestId,
      executionId,
      workflowId,
      workspaceId,
      userId: actorUserId,
      principal,
      billingAttribution,
      workflowUserId: workflow.userId,
      triggerType,
      triggerBlockId,
      useDraftState,
      startTime: new Date().toISOString(),
      isClientSession: false,
      enforceCredentialAccess: useAuthenticatedUserAsActor,
      isPublicApiAccess,
      largeValueExecutionIds: [executionId],
      largeValueKeys: [],
      fileKeys: [],
      allowLargeValueWorkflowScope: false,
      callChain,
      executionMode: 'sync',
    }

    const timeoutController = createTimeoutAbortController(preprocessResult.executionTimeout?.sync)
    let requestAborted = false
    const abortFromRequest = () => {
      requestAborted = true
      timeoutController.abort()
    }
    if (abortSignal?.aborted) {
      abortFromRequest()
    } else {
      abortSignal?.addEventListener('abort', abortFromRequest)
    }
    const isRequestAborted = () => requestAborted || Boolean(abortSignal?.aborted)

    const compactionContext = {
      workspaceId,
      workflowId,
      executionId,
      userId: actorUserId,
      rejectLargeInlineOutput,
    }

    const runSynchronousWorkflow = async (): Promise<ExecuteWorkflowServiceTerminalResult> => {
      try {
        const snapshot = new ExecutionSnapshot(
          metadata,
          workflow,
          processedInput,
          workflowVariables,
          selectedOutputs
        )

        const result = await executeWorkflowCore({
          snapshot,
          callbacks: {},
          loggingSession,
          includeFileBase64,
          base64MaxBytes,
          abortSignal: timeoutController.signal,
          runFromBlock,
        })

        await handlePostExecutionPauseState({ result, workflowId, executionId, loggingSession })

        if (
          result.status === 'cancelled' &&
          isRequestAborted() &&
          !timeoutController.isTimedOut()
        ) {
          reqLogger.info('Execution cancelled by client disconnect')
          await loggingSession.markAsFailed('Client cancelled request')
          return {
            ok: true,
            executionId,
            workflowId,
            status: 'cancelled',
            aborted: 'client',
            output: undefined,
            error: { message: 'Client cancelled request', code: 'CANCELLED' },
            resolvedSecretTraceProvenance: result.executionState?.resolvedSecretTraceProvenance,
            hasResponseBlock: false,
          }
        }

        if (
          result.status === 'cancelled' &&
          timeoutController.isTimedOut() &&
          timeoutController.timeoutMs
        ) {
          const timeoutErrorMessage = getTimeoutErrorMessage(null, timeoutController.timeoutMs)
          reqLogger.info('Execution timed out', { timeoutMs: timeoutController.timeoutMs })
          await loggingSession.markAsFailed(timeoutErrorMessage)
          const compactTimeoutOutput = await compactServiceOutput(result.output, compactionContext)
          return {
            ok: true,
            executionId,
            workflowId,
            status: 'failed',
            aborted: 'timeout',
            output: compactTimeoutOutput,
            error: { message: timeoutErrorMessage, code: 'TIMEOUT' },
            resolvedSecretTraceProvenance: result.executionState?.resolvedSecretTraceProvenance,
            hasResponseBlock: false,
            startedAt: result.metadata?.startTime,
            endedAt: result.metadata?.endTime,
            durationMs: result.metadata?.duration,
          }
        }

        const outputWithBase64 =
          includeFileBase64 && !rejectLargeInlineOutput
            ? ((await hydrateUserFilesWithBase64(result.output, {
                requestId,
                workspaceId,
                workflowId,
                executionId,
                largeValueExecutionIds: [executionId],
                largeValueKeys: result.metadata?.largeValueKeys ?? [],
                fileKeys: result.metadata?.fileKeys ?? [],
                allowLargeValueWorkflowScope: false,
                userId: actorUserId,
                principal,
                maxBytes: base64MaxBytes,
                preserveLargeValueMetadata: true,
              })) as NormalizedBlockOutput)
            : result.output

        const compactOutput = await compactServiceOutput(outputWithBase64, compactionContext)

        const status: ExecuteWorkflowServiceRun['status'] =
          result.status === 'paused'
            ? 'paused'
            : result.status === 'cancelled'
              ? 'cancelled'
              : result.success
                ? 'completed'
                : 'failed'

        return {
          ok: true,
          executionId,
          workflowId,
          status,
          aborted: null,
          output: compactOutput,
          error:
            status === 'failed' || (status === 'cancelled' && result.error)
              ? classifyExecutionError(result.error ? new Error(result.error) : undefined, result)
              : null,
          resolvedSecretTraceProvenance: result.executionState?.resolvedSecretTraceProvenance,
          hasResponseBlock: workflowHasResponseBlock(result),
          startedAt: result.metadata?.startTime,
          endedAt: result.metadata?.endTime,
          durationMs: result.metadata?.duration,
        }
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error, 'Unknown error')
        const executionResult = hasExecutionResult(error) ? error.executionResult : undefined

        if (isRequestAborted() && !timeoutController.isTimedOut()) {
          reqLogger.info('Execution aborted after client disconnect')
          return {
            ok: true,
            executionId,
            workflowId,
            status: 'cancelled',
            aborted: 'client',
            output: undefined,
            error: { message: 'Client cancelled request', code: 'CANCELLED' },
            resolvedSecretTraceProvenance:
              executionResult?.executionState?.resolvedSecretTraceProvenance,
            hasResponseBlock: false,
          }
        }

        if (
          error instanceof PayloadSizeLimitError &&
          rejectLargeInlineOutput &&
          error.label === 'Workflow execution response'
        ) {
          return failure({
            kind: 'output_too_large',
            message: 'Workflow execution response exceeds maximum size',
            statusCode: 413,
            code: 'workflow_response_too_large',
            executionId,
          })
        }

        reqLogger.error(`Execution failed: ${errorMessage}`)

        let compactErrorOutput: NormalizedBlockOutput | undefined
        if (executionResult && Object.hasOwn(executionResult, 'output')) {
          try {
            compactErrorOutput = await compactServiceOutput(
              executionResult.output,
              compactionContext
            )
          } catch (compactError) {
            if (
              compactError instanceof PayloadSizeLimitError &&
              rejectLargeInlineOutput &&
              compactError.label === 'Workflow execution response'
            ) {
              return failure({
                kind: 'output_too_large',
                message: 'Workflow execution response exceeds maximum size',
                statusCode: 413,
                code: 'workflow_response_too_large',
                executionId,
              })
            }
            throw compactError
          }
        }

        return {
          ok: true,
          executionId,
          workflowId,
          status: 'failed',
          aborted: null,
          output: compactErrorOutput,
          error: classifyExecutionError(error, executionResult),
          resolvedSecretTraceProvenance:
            executionResult?.executionState?.resolvedSecretTraceProvenance,
          hasResponseBlock: false,
          startedAt: executionResult?.metadata?.startTime,
          endedAt: executionResult?.metadata?.endTime,
          durationMs: executionResult?.metadata?.duration,
        }
      } finally {
        abortSignal?.removeEventListener('abort', abortFromRequest)
        timeoutController.cleanup()
      }
    }

    const pending = runSynchronousWorkflow()
    if (mode === 'sync-result-stream') {
      /** Keep the claim until the pending run can prove whether durable ownership exists. */
      executionIdClaimTransferred = true
      return {
        ok: true,
        executionId,
        pending: pending.finally(settleExecutionIdClaim),
        cancel: abortFromRequest,
      }
    }

    return await pending
  } catch (error) {
    reqLogger.error('Failed to start workflow execution', { error: toError(error).message })
    if (executionId) await releaseExecutionSlot(executionId)
    return failure({
      kind: 'infra',
      message: toError(error).message || 'Failed to start workflow execution',
      statusCode: 500,
    })
  } finally {
    if (!executionIdClaimTransferred) await settleExecutionIdClaim()
  }
}

/**
 * Resolves caller-facing `selectedOutputs` refs (`BlockName.path` or
 * `<uuid>.path`) to internal `<blockId>_<path>` ids — same normalization the
 * v1 streaming path applies.
 */
export async function resolveOutputIds(
  selectedOutputs: string[] | undefined,
  blocks: Record<string, unknown>
): Promise<string[] | undefined> {
  return resolveOutputSelectors({
    selectedOutputs,
    currentBlocks: blocks as Record<string, BlockState>,
  })
}
