import type { WorkflowExecutionPrincipal } from '@sim/auth/principal'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { isPlainRecord, isRecordLike } from '@sim/utils/object'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import type { PiiBlockOutputRedaction } from '@/executor/execution/types'
import { WorkflowBlockHandler } from '@/executor/handlers/workflow/workflow-handler'
import type { ExecutionContext } from '@/executor/types'
import { projectResolvedSecretDiagnosticContent } from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { SerializedBlock } from '@/serializer/types'
import type { ToolResponse } from '@/tools/types'

const logger = createLogger('CustomBlockToolRunner')

/** Server-set execution context propagated to every agent tool call. */
export interface CustomBlockExecutorContext {
  workspaceId?: string
  userId?: string
  workflowId?: string
  callChain?: string[]
  isDeployedContext?: boolean
  billingAttribution?: BillingAttributionSnapshot
  /**
   * The INVOKING agent run's execution id. Server-set, never model-supplied.
   * Without it the child's correlation would name an id no log row ever has, so
   * a publisher could not trace the run back to the consumer execution — and the
   * cancellation bridge would subscribe to an id nothing ever cancels.
   */
  executionId?: string
  /** The invoking run's request id, so both sides share one trace identifier. */
  requestId?: string
}

interface CustomBlockToolParams {
  /** The `custom_block_*` type to run — authority is re-resolved from it server-side. */
  blockType?: string
  /** Input values keyed by the source field's stable id (assembled + LLM-filled). */
  inputMapping?: Record<string, unknown> | string
  _context?: CustomBlockExecutorContext
}

/**
 * Build a minimal top-level `ExecutionContext` for running a workflow or a custom
 * block as an agent tool. Every value comes from the server-set `_context`
 * (LLM-proof) or from `options` (not model-reachable at all), including the
 * invoking run's execution and request ids so the child's log correlation names a
 * real execution. `WorkflowBlockHandler.executeCore` reads `workspaceId` (org-scopes
 * the authority lookup), `metadata` (read unconditionally), and `callChain`
 * (recursion depth guard, inherited so it never resets across hops), plus the
 * non-optional scaffolding.
 *
 * `environmentVariables` is required rather than defaulted because only the caller
 * knows which identity's env the child must run under: the custom-block branch
 * re-derives the publisher's env from `getCustomBlockAuthority` and passes `{}`,
 * while every other caller must forward the invoking run's map or the child
 * resolves `{{VAR}}` to the literal reference string. Silent omission is exactly
 * how the workflow-as-agent-tool path shipped with an empty map.
 *
 * `piiBlockOutputRedaction` stays optional because `undefined` is its correct
 * value rather than a wrong identity: most tenants have no policy at all, and the
 * custom-block branch omits it deliberately — that child runs cross-workspace
 * under the publisher's identity, so the consumer's redaction rules would be the
 * wrong tenant's, exactly as the consumer's env would be.
 * Keep in sync with `WorkflowBlockHandler.executeCore`.
 */
export function buildCustomBlockExecutionContext(
  context: CustomBlockExecutorContext,
  options: {
    /** The invoking run's decrypted env, or `{}` when the child re-derives its own. */
    environmentVariables: Record<string, string>
    abortSignal?: AbortSignal
    resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
    principal?: WorkflowExecutionPrincipal
    /** The invoking run's in-flight block-output redaction policy. */
    piiBlockOutputRedaction?: PiiBlockOutputRedaction
  }
): ExecutionContext {
  // Prefer the invoking agent run's ids so correlation and cancellation both
  // point at a real execution; fall back only when a caller could not supply them.
  const executionId = context.executionId ?? generateId()
  return {
    workflowId: context.workflowId ?? 'custom-block-tool',
    workspaceId: context.workspaceId,
    userId: context.userId,
    principal: options.principal,
    executionId,
    isDeployedContext: context.isDeployedContext,
    // Inherit the accumulated chain so the handler appends + validates depth;
    // resetting to [] would let a self-referential custom block recurse unbounded.
    callChain: context.callChain ?? [],
    // Without this the child's cancellation bridge has nothing to abort on:
    // the agent tool loop owns the only signal reaching this path.
    abortSignal: options.abortSignal,
    resolvedSecretTraceRegistry: options.resolvedSecretTraceRegistry,
    environmentVariables: options.environmentVariables,
    piiBlockOutputRedaction: options.piiBlockOutputRedaction,
    blockStates: new Map(),
    executedBlocks: new Set(),
    blockLogs: [],
    decisions: { router: new Map(), condition: new Map() },
    completedLoops: new Set(),
    activeExecutionPath: new Set(),
    // `WorkflowBlockHandler` reads only `billingAttribution` + `executionMode` on the
    // custom-block path; `duration` is the sole required field on the metadata type.
    metadata: {
      duration: 0,
      requestId: context.requestId ?? generateId(),
      executionId,
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      userId: context.userId,
      principal: options.principal,
      billingAttribution: context.billingAttribution,
      executionMode: 'sync',
    },
  }
}

/**
 * Runs a published custom block (deploy-as-block) as an Agent tool, in-process via
 * `WorkflowBlockHandler` — the same invocation boundary the canvas uses — so
 * authority (org-scoped owner identity, latest deployment, curated outputs,
 * required-input enforcement) is resolved server-side from the block type, and the
 * child's spend is billed to the source workspace by its own logging session. No
 * HTTP hop and no body-field trust: the block type + consumer workspace come from
 * the server-set `_context`, not the model.
 *
 * Lives in a server-only module (dynamic-imported by `executeTool`) so the
 * client-bundled tool registry never pulls in the executor/db dependency graph.
 */
export async function runCustomBlockTool(
  params: CustomBlockToolParams,
  options: {
    abortSignal?: AbortSignal
    resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
    principal?: WorkflowExecutionPrincipal
  } = {}
): Promise<ToolResponse> {
  if (!params.blockType) {
    return { success: false, output: {}, error: 'Missing custom block type' }
  }

  const ctx = buildCustomBlockExecutionContext(params._context ?? {}, {
    environmentVariables: {},
    abortSignal: options.abortSignal,
    resolvedSecretTraceRegistry: options.resolvedSecretTraceRegistry,
    principal: options.principal,
  })
  const block: SerializedBlock = {
    id: generateId(),
    position: { x: 0, y: 0 },
    config: { tool: 'workflow_executor', params: {} },
    inputs: {},
    outputs: {},
    metadata: { id: params.blockType },
    enabled: true,
  }

  try {
    const output = await new WorkflowBlockHandler().execute(ctx, block, {
      inputMapping: params.inputMapping,
    })
    // Custom blocks never stream (no `onStream` on the synthetic ctx), so the
    // handler always returns the projected BlockOutput object.
    const normalized: Record<string, any> = isRecordLike(output) ? output : { result: output }
    return { success: true, output: normalized }
  } catch (error) {
    // The handler throws a consumer-safe `ChildWorkflowError` on failure. The
    // child's own logging session already billed whatever it spent before failing,
    // so nothing is rolled up here.
    const message = getErrorMessage(error, 'Custom block execution failed')
    const logProjection = projectResolvedSecretDiagnosticContent(
      { blockType: params.blockType, message },
      options.resolvedSecretTraceRegistry
    )
    logger.info(
      'Custom block tool execution failed',
      logProjection.safe && isPlainRecord(logProjection.value)
        ? logProjection.value
        : {
            hasBlockType: params.blockType.length > 0,
            errorName: error instanceof Error ? error.name : 'UnknownError',
            redacted: true,
          }
    )
    return { success: false, output: {}, error: message }
  }
}
