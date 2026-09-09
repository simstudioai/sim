import type { WorkflowExecutionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import {
  assertBillingAttributionSnapshot,
  type BillingAttributionSnapshot,
} from '@/lib/billing/core/billing-attribution'
import type { AsyncExecutionCorrelation } from '@/lib/core/async-jobs/types'
import { LoggingSession } from '@/lib/logs/execution/logging-session'
import { captureServerEvent } from '@/lib/posthog/server'
import { executeWorkflowCore } from '@/lib/workflows/executor/execution-core'
import { handlePostExecutionPauseState } from '@/lib/workflows/executor/pause-persistence'
import { ExecutionSnapshot } from '@/executor/execution/snapshot'
import type {
  BlockCompletionCallbackData,
  ExecutionMetadata,
  SerializableExecutionState,
} from '@/executor/execution/types'
import type { ExecutionResult, StreamingExecution } from '@/executor/types'
import { attachExecutionResult, hasExecutionResult } from '@/executor/utils/errors'
import type { ResolvedSecretTraceProvenanceV1 } from '@/executor/utils/resolved-secret-trace-registry'
import type { CoreTriggerType } from '@/stores/logs/filters/types'

const logger = createLogger('WorkflowExecution')

export interface ExecuteWorkflowOptions {
  enabled: boolean
  principal: WorkflowExecutionPrincipal
  selectedOutputs?: string[]
  isSecureMode?: boolean
  workflowTriggerType?: CoreTriggerType | 'table'
  /**
   * If set, the executor enters the workflow at this block instead of resolving a Start block.
   * Use for trigger-originated runs (webhooks, table triggers, schedules) where the entry point
   * is the trigger block itself.
   */
  triggerBlockId?: string
  onStream?: (streamingExec: StreamingExecution) => Promise<void>
  /** Fires before each block runs; lets callers track per-block lifecycle (e.g. table-cell live state). */
  onBlockStart?: (
    blockId: string,
    blockName: string,
    blockType: string,
    executionOrder: number
  ) => Promise<void>
  onBlockComplete?: (blockId: string, data: BlockCompletionCallbackData) => Promise<void>
  /** Transfers post-execution logging ownership to the streaming caller after execution succeeds. */
  skipLoggingComplete?: boolean
  includeFileBase64?: boolean
  base64MaxBytes?: number
  largeValueKeys?: string[]
  fileKeys?: string[]
  abortSignal?: AbortSignal
  /** Use the live/draft workflow state instead of the deployed state. Used by copilot. */
  useDraftState?: boolean
  /** Immutable workflow state selected by a trusted server-side trigger boundary. */
  workflowStateOverride?: NonNullable<ExecutionMetadata['workflowStateOverride']>
  /** Stop execution after this block completes. Used for "run until block" feature. */
  stopAfterBlockId?: string
  /** Run-from-block configuration using a prior execution snapshot. */
  runFromBlock?: {
    startBlockId: string
    sourceSnapshot: SerializableExecutionState
    sourceExecutionId?: string
  }
  /** Trusted encrypted provenance supplied by a server-only caller before execution starts. */
  trustedInitialResolvedSecretTraceProvenance?: ResolvedSecretTraceProvenanceV1
  executionMode?: 'sync' | 'stream' | 'async'
  /**
   * Whether the run has an identifiable caller to authorize against, from
   * `principal.kind !== 'workspace_api_key'` (see {@link ExecutionMetadata.enforceCredentialAccess}).
   * Streaming runs reach the executor through here rather than through the route's
   * own metadata, so callers must forward it or secrets resolve as the workflow
   * owner on the streaming path and as the caller everywhere else.
   */
  enforceCredentialAccess?: boolean
  /** Anonymous public-API run (see {@link ExecutionMetadata.isPublicApiAccess}). */
  isPublicApiAccess?: boolean
  /** Immutable actor/payer decision captured by preprocessing. */
  billingAttribution?: BillingAttributionSnapshot
  /** Server-issued run identity persisted with the execution log and snapshot. */
  trustedExecutionCorrelation?: AsyncExecutionCorrelation
  /** Deployed-chat thinking policy; persisted on the snapshot for resume. */
  includeThinking?: boolean
  /** Deployed-chat tool lifecycle policy; persisted on the snapshot for resume. */
  includeToolCalls?: boolean
  /**
   * Run-level agent-events opt-in (see {@link ExecutionMetadata.agentEvents}).
   * Callers set this only when the surface consumes thinking/tool events.
   */
  agentEvents?: boolean
  /**
   * Gate subject for this run, separate from the billing actor
   * (see {@link ExecutionMetadata.capabilityGovernedUserId}). Omit unless the
   * trigger genuinely has a person distinct from the one it bills.
   */
  capabilityGovernedUserId?: string | null
}

export interface WorkflowInfo {
  id: string
  userId: string
  workspaceId?: string | null
  isDeployed?: boolean
  variables?: Record<string, any>
}

export async function executeWorkflow(
  workflow: WorkflowInfo,
  requestId: string,
  input: unknown | undefined,
  actorUserId: string,
  streamConfig?: ExecuteWorkflowOptions,
  providedExecutionId?: string
): Promise<ExecutionResult> {
  if (!workflow.workspaceId) {
    throw new Error(`Workflow ${workflow.id} has no workspaceId`)
  }

  const workflowId = workflow.id
  const workspaceId = workflow.workspaceId
  if (!streamConfig?.billingAttribution) {
    throw new Error('Billing attribution is required for workspace execution')
  }
  if (!streamConfig.principal) {
    throw new Error('Workflow execution principal is required')
  }
  const principal = streamConfig.principal
  const billingAttribution = assertBillingAttributionSnapshot(streamConfig.billingAttribution)
  if (
    billingAttribution.actorUserId !== actorUserId ||
    billingAttribution.workspaceId !== workspaceId
  ) {
    throw new Error('Workflow billing attribution does not match its actor and workspace')
  }

  const executionId = providedExecutionId || generateId()
  const triggerType = streamConfig?.workflowTriggerType || 'api'
  const loggingSession = new LoggingSession(workflowId, executionId, triggerType, requestId)
  if (streamConfig?.trustedExecutionCorrelation) {
    loggingSession.setTrustedExecutionCorrelation(streamConfig.trustedExecutionCorrelation)
  }
  let postExecutionOwnershipTransferred = false
  /**
   * Held outside the `try` so the catch can carry it. The executor attaches its result when the
   * run itself throws, but the post-execution work below can throw after a run has already
   * produced one — and callers read a missing result as proof that no block ran.
   */
  let executionResult: ExecutionResult | undefined

  try {
    const metadata: ExecutionMetadata = {
      requestId,
      executionId,
      workflowId,
      workspaceId,
      userId: actorUserId,
      capabilityGovernedUserId: streamConfig?.capabilityGovernedUserId,
      principal,
      billingAttribution,
      workflowUserId: workflow.userId,
      triggerType,
      triggerBlockId: streamConfig?.triggerBlockId,
      useDraftState: streamConfig?.useDraftState ?? false,
      workflowStateOverride: streamConfig?.workflowStateOverride,
      startTime: new Date().toISOString(),
      isClientSession: false,
      enforceCredentialAccess: streamConfig?.enforceCredentialAccess ?? false,
      isPublicApiAccess: streamConfig?.isPublicApiAccess ?? false,
      largeValueExecutionIds: Array.from(new Set([executionId])),
      largeValueKeys: streamConfig?.largeValueKeys,
      fileKeys: streamConfig?.fileKeys,
      executionMode: streamConfig?.executionMode,
      includeThinking: streamConfig?.includeThinking === true ? true : undefined,
      includeToolCalls:
        typeof streamConfig?.includeToolCalls === 'boolean'
          ? streamConfig.includeToolCalls
          : undefined,
      agentEvents: streamConfig?.agentEvents === true ? true : undefined,
      correlation: streamConfig?.trustedExecutionCorrelation,
    }

    const snapshot = new ExecutionSnapshot(
      metadata,
      workflow,
      input,
      streamConfig?.workflowStateOverride?.variables ?? workflow.variables ?? {},
      streamConfig?.selectedOutputs || []
    )

    const executionStartMs = Date.now()

    const result = (executionResult = await executeWorkflowCore({
      snapshot,
      callbacks: {
        onStream: streamConfig?.onStream,
        onBlockStart: streamConfig?.onBlockStart
          ? async (
              blockId: string,
              blockName: string,
              blockType: string,
              executionOrder: number
            ) => {
              await streamConfig.onBlockStart!(blockId, blockName, blockType, executionOrder)
            }
          : undefined,
        onBlockComplete: streamConfig?.onBlockComplete
          ? async (
              blockId: string,
              _blockName: string,
              _blockType: string,
              data: BlockCompletionCallbackData
            ) => {
              await streamConfig.onBlockComplete!(blockId, data)
            }
          : undefined,
      },
      loggingSession,
      includeFileBase64: streamConfig?.includeFileBase64,
      base64MaxBytes: streamConfig?.base64MaxBytes,
      abortSignal: streamConfig?.abortSignal,
      stopAfterBlockId: streamConfig?.stopAfterBlockId,
      trustedInitialResolvedSecretTraceProvenance:
        streamConfig?.trustedInitialResolvedSecretTraceProvenance,
      runFromBlock: streamConfig?.runFromBlock,
    }))

    const blockTypes = [
      ...new Set(
        (result.logs ?? [])
          .map((log) => log.blockType)
          .filter((t): t is string => typeof t === 'string')
      ),
    ]
    if (result.status !== 'paused') {
      captureServerEvent(
        actorUserId,
        'workflow_executed',
        {
          workflow_id: workflowId,
          workspace_id: workspaceId,
          trigger_type: triggerType,
          success: result.success,
          block_count: result.logs?.length ?? 0,
          block_types: blockTypes.join(','),
          duration_ms: Date.now() - executionStartMs,
        },
        {
          groups: { workspace: workspaceId },
          setOnce: { first_execution_at: new Date().toISOString() },
        }
      )
    }

    await handlePostExecutionPauseState({ result, workflowId, executionId, loggingSession })

    if (streamConfig?.skipLoggingComplete) {
      postExecutionOwnershipTransferred = true
      return {
        ...result,
        _streamingMetadata: {
          loggingSession,
          processedInput: input,
        },
      }
    }

    return result
  } catch (caught: unknown) {
    /**
     * Normalized before anything reads it, for the reason the executor normalizes its own throw:
     * a value that cannot carry the result would otherwise reach callers bare, and they read a
     * missing result as proof that no block ran. `toError` returns an `Error` unchanged, so a
     * custom error class keeps its identity and every ordinary failure is untouched.
     */
    const error = toError(caught)
    /**
     * Carries the run's result on a failure raised after it produced one — the post-execution
     * work below the executor call can throw, and the executor never saw it. Skipped when the
     * executor already attached its own, which is the more specific record.
     */
    if (executionResult && !hasExecutionResult(error)) {
      attachExecutionResult(error, executionResult)
    }
    const errorDiagnostic = loggingSession.projectDiagnosticError(error)
    logger.error(`[${requestId}] Workflow execution failed`, errorDiagnostic)

    captureServerEvent(
      actorUserId,
      'workflow_execution_failed',
      {
        workflow_id: workflow.id,
        workspace_id: workspaceId,
        trigger_type: streamConfig?.workflowTriggerType || 'api',
        error_message:
          typeof errorDiagnostic.error === 'string'
            ? errorDiagnostic.error
            : 'Workflow execution failed',
      },
      { groups: { workspace: workspaceId } }
    )

    throw error
  } finally {
    if (!postExecutionOwnershipTransferred) {
      await loggingSession.waitForPostExecution()
    }
  }
}
