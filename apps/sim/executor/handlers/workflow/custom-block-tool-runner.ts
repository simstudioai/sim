import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { WorkflowBlockHandler } from '@/executor/handlers/workflow/workflow-handler'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'
import type { ToolResponse } from '@/tools/types'

const logger = createLogger('CustomBlockToolRunner')

/** Server-set execution context propagated to every agent tool call. */
interface CustomBlockExecutorContext {
  workspaceId?: string
  userId?: string
  workflowId?: string
  callChain?: string[]
  isDeployedContext?: boolean
  billingAttribution?: BillingAttributionSnapshot
}

interface CustomBlockToolParams {
  /** The `custom_block_*` type to run — authority is re-resolved from it server-side. */
  blockType?: string
  /** Input values keyed by the source field's stable id (assembled + LLM-filled). */
  inputMapping?: Record<string, unknown> | string
  _context?: CustomBlockExecutorContext
}

/**
 * Build a minimal top-level `ExecutionContext` for running a custom block as an
 * agent tool. Every value comes from the server-set `_context` (LLM-proof) plus a
 * fresh executionId. `WorkflowBlockHandler`'s custom-block path re-derives owner
 * identity, env, and billing from `getCustomBlockAuthority`, so this only needs the
 * fields that path reads — `workspaceId` (org-scopes the authority lookup),
 * `metadata` (read unconditionally at `executeCore`), and `callChain` (recursion
 * depth guard, inherited so it never resets across hops) — plus the non-optional
 * scaffolding. Keep in sync with `WorkflowBlockHandler.executeCore`'s custom branch.
 */
export function buildCustomBlockExecutionContext(
  context: CustomBlockExecutorContext
): ExecutionContext {
  const executionId = generateId()
  return {
    workflowId: context.workflowId ?? 'custom-block-tool',
    workspaceId: context.workspaceId,
    userId: context.userId,
    executionId,
    isDeployedContext: context.isDeployedContext,
    // Inherit the accumulated chain so the handler appends + validates depth;
    // resetting to [] would let a self-referential custom block recurse unbounded.
    callChain: context.callChain ?? [],
    environmentVariables: {},
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
      requestId: generateId(),
      executionId,
      workflowId: context.workflowId,
      workspaceId: context.workspaceId,
      userId: context.userId,
      billingAttribution: context.billingAttribution,
      executionMode: 'sync',
    },
  }
}

/**
 * Runs a published custom block (deploy-as-block) as an Agent tool, in-process via
 * `WorkflowBlockHandler` — the same invocation boundary the canvas uses — so
 * authority (org-scoped owner identity, latest deployment, curated outputs,
 * required-input enforcement, cost roll-up) is resolved server-side from the block
 * type. No HTTP hop and no body-field trust: the block type + consumer workspace
 * come from the server-set `_context`, not the model.
 *
 * Lives in a server-only module (dynamic-imported by `executeTool`) so the
 * client-bundled tool registry never pulls in the executor/db dependency graph.
 */
export async function runCustomBlockTool(params: CustomBlockToolParams): Promise<ToolResponse> {
  if (!params.blockType) {
    return { success: false, output: {}, error: 'Missing custom block type' }
  }

  const ctx = buildCustomBlockExecutionContext(params._context ?? {})
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
    // handler always returns the projected BlockOutput object (with `cost.total`).
    const normalized: Record<string, any> =
      output && typeof output === 'object' && !Array.isArray(output) ? output : { result: output }
    return { success: true, output: normalized }
  } catch (error) {
    // The handler throws a consumer-safe `ChildWorkflowError` on failure. Partial
    // child cost rides its trace spans, but the provider tool loop only bills cost
    // from successful results, so the error message alone is surfaced here.
    const message = getErrorMessage(error, 'Custom block execution failed')
    logger.info('Custom block tool execution failed', { blockType: params.blockType, message })
    return { success: false, output: {}, error: message }
  }
}
