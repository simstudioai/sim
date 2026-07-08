import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { getPersonalAndWorkspaceEnv } from '@/lib/environment/utils'
import { buildNextCallChain, validateCallChain } from '@/lib/execution/call-chain'
import { calculateCostSummary } from '@/lib/logs/execution/logging-factory'
import { snapshotService } from '@/lib/logs/execution/snapshot/service'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import type { TraceSpan } from '@/lib/logs/types'
import { getCustomBlockAuthority } from '@/lib/workflows/custom-blocks/operations'
import { extractInputFieldsFromBlocks } from '@/lib/workflows/input-format'
import { type CustomBlockOutput, isCustomBlockType } from '@/blocks/custom/build-config'
import type { BlockOutput } from '@/blocks/types'
import { Executor } from '@/executor'
import { BlockType, DEFAULTS, HTTP } from '@/executor/constants'
import { ChildWorkflowError } from '@/executor/errors/child-workflow-error'
import type { WorkflowNodeMetadata } from '@/executor/execution/types'
import type {
  BlockHandler,
  ExecutionContext,
  ExecutionResult,
  StreamingExecution,
} from '@/executor/types'
import { hasExecutionResult } from '@/executor/utils/errors'
import { buildAPIUrl, buildAuthHeaders } from '@/executor/utils/http'
import { getIterationContext } from '@/executor/utils/iteration-context'
import { parseJSON } from '@/executor/utils/json'
import { lazyCleanupInputMapping } from '@/executor/utils/lazy-cleanup'
import { Serializer } from '@/serializer'
import type { SerializedBlock } from '@/serializer/types'

const logger = createLogger('WorkflowBlockHandler')

/** Read a dot-path (e.g. `content.text`) out of a block output object. */
function getValueAtPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key]
    return undefined
  }, source)
}

/**
 * Remap a custom block's resolved input mapping from source-field ids to the
 * child workflow's current field names. The consumer's sub-block values are keyed
 * by the stable field id (so renames don't cook them); the child is addressed by
 * name. Legacy fields without an id are keyed by name and pass through unchanged.
 * Keys that match no current field are dropped.
 */
export function remapCustomBlockInputKeys(
  mapping: Record<string, unknown>,
  childBlocks: Record<string, unknown>
): Record<string, unknown> {
  const fields = extractInputFieldsFromBlocks(childBlocks)
  const remapped: Record<string, unknown> = {}
  for (const field of fields) {
    const key =
      field.id && field.id in mapping ? field.id : field.name in mapping ? field.name : null
    if (key === null) continue
    let value = mapping[key]
    // object/array inputs are authored in a JSON code editor, so their value is a
    // JSON *string*. Decode it against the child's real Start field type so the
    // child receives the actual object/array (or primitive) — not the string
    // re-encoded by the mapping's `JSON.stringify` (`"Theodore"` → `\"Theodore\"`).
    if ((field.type === 'object' || field.type === 'array') && typeof value === 'string') {
      try {
        value = JSON.parse(value)
      } catch {
        // Not valid JSON — pass the raw string through unchanged.
      }
    }
    remapped[field.name] = value
  }
  return remapped
}

/**
 * Canonical hosted-key spend of a child run: the model/tool cost the way the
 * parent bills it (recursing nested/iteration spans and de-duping model
 * breakdowns), minus the base execution charge the parent applies once itself.
 * A naive top-level `cost.total` sum undercounts when spend sits on nested children.
 */
function aggregateChildCost(childTraceSpans: TraceSpan[]): number {
  if (childTraceSpans.length === 0) return 0
  const summary = calculateCostSummary(childTraceSpans)
  return Math.max(0, summary.totalCost - summary.baseExecutionCharge)
}

/**
 * A single cost-only span so a FAILED custom block still bills the hosted-key spend
 * its child already consumed (`block-executor` bills `error.childTraceSpans`),
 * without exposing any of the source workflow's internal spans. Empty when free.
 */
function buildCostCarrierSpans(childCost: number, blockName: string, type: string): TraceSpan[] {
  if (childCost <= 0) return []
  const now = new Date().toISOString()
  return [
    {
      id: generateId(),
      name: blockName,
      type,
      duration: 0,
      startTime: now,
      endTime: now,
      status: 'error',
      cost: { total: childCost },
    },
  ]
}

type WorkflowTraceSpan = TraceSpan & {
  metadata?: Record<string, unknown>
  children?: WorkflowTraceSpan[]
  output?: (Record<string, unknown> & { childTraceSpans?: WorkflowTraceSpan[] }) | null
}

/**
 * Handler for workflow blocks that execute other workflows inline.
 * Creates sub-execution contexts and manages data flow between parent and child workflows.
 */
export class WorkflowBlockHandler implements BlockHandler {
  private serializer = new Serializer()

  canHandle(block: SerializedBlock): boolean {
    const id = block.metadata?.id
    return id === BlockType.WORKFLOW || id === BlockType.WORKFLOW_INPUT || isCustomBlockType(id)
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput | StreamingExecution> {
    return this.executeCore(ctx, block, inputs)
  }

  async executeWithNode(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>,
    nodeMetadata: WorkflowNodeMetadata
  ): Promise<BlockOutput | StreamingExecution> {
    return this.executeCore(ctx, block, inputs, nodeMetadata)
  }

  private async executeCore(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>,
    nodeMetadata?: WorkflowNodeMetadata
  ): Promise<BlockOutput | StreamingExecution> {
    logger.info(`Executing workflow block: ${block.id}`)

    const blockTypeId = block.metadata?.id
    const isCustomBlock = isCustomBlockType(blockTypeId)

    // Custom (deploy-as-block) blocks are an invocation boundary: resolve the bound
    // workflow + authority from the DB (never trust the serialized value) and run the
    // source workflow's LATEST deployment under its OWNER's authority — the same
    // identity a normal deployed API/schedule/webhook run uses — so a cross-workspace
    // consumer needs no permission on the source workflow. Owner deletion cascade-
    // deletes the workflow → the custom_block row, so the block never orphans.
    let workflowId = inputs.workflowId
    let loadUserId = ctx.userId
    let exposedOutputs: CustomBlockOutput[] = []
    if (isCustomBlock) {
      const authority = await getCustomBlockAuthority(blockTypeId as string, ctx.workspaceId)
      if (!authority) {
        throw new Error('This custom block is no longer available')
      }
      workflowId = authority.workflowId
      loadUserId = authority.ownerUserId
      exposedOutputs = authority.exposedOutputs
    }

    if (!workflowId) {
      throw new Error('No workflow selected for execution')
    }

    // Always run the latest deployment for custom blocks, even from a draft-context parent run.
    const useDeployed = isCustomBlock || ctx.isDeployedContext

    let childWorkflowName = workflowId

    // Unique ID per invocation — used to correlate child block events with this specific
    // workflow block execution, preventing cross-iteration child mixing in loop contexts.
    const instanceId = generateId()

    const childCallChain = buildNextCallChain(ctx.callChain || [], workflowId)
    const depthError = validateCallChain(childCallChain)
    if (depthError) {
      throw new ChildWorkflowError({
        message: depthError,
        childWorkflowName,
      })
    }

    // A custom block runs the source's latest deployment; if the source has been
    // undeployed there's nothing to run. Check + throw a clear, consumer-safe
    // reason BEFORE the try so the catch's generic sanitizer doesn't mask it (the
    // message names no source internals). The block still renders (its schema comes
    // from stored curated inputs), so this is the only failure mode to surface.
    if (isCustomBlock) {
      const deployed = await this.checkChildDeployment(workflowId, loadUserId)
      if (!deployed) {
        throw new Error('This block’s workflow is not deployed. Redeploy it to use this block.')
      }
    }

    let childWorkflowSnapshotId: string | undefined
    try {
      if (useDeployed && !isCustomBlock) {
        const hasActiveDeployment = await this.checkChildDeployment(workflowId, loadUserId)
        if (!hasActiveDeployment) {
          throw new Error(
            `Child workflow is not deployed. Please deploy the workflow before invoking it.`
          )
        }
      }

      const childWorkflow = useDeployed
        ? await this.loadChildWorkflowDeployed(workflowId, loadUserId)
        : await this.loadChildWorkflow(workflowId, ctx.userId)

      if (!childWorkflow) {
        throw new Error(`Child workflow ${workflowId} not found`)
      }

      // Custom blocks are org-scoped and deliberately cross-workspace: the source
      // workflow lives in the publisher's workspace, not the consumer's. Their
      // boundary is the org overlay + `getCustomBlockAuthority`, so the
      // same-workspace assert (which guards regular workflow blocks) must be
      // skipped or every custom-block invocation from another workspace throws.
      if (!isCustomBlock) {
        this.assertChildWorkflowInWorkspace(workflowId, childWorkflow.workspaceId, ctx.workspaceId)
      }

      childWorkflowName = childWorkflow.name || 'Unknown Workflow'

      logger.info(
        `Executing child workflow: ${childWorkflowName} (${workflowId}), call chain depth ${ctx.callChain?.length || 0}`
      )

      let childWorkflowInput: Record<string, any> = {}

      if (inputs.inputMapping !== undefined && inputs.inputMapping !== null) {
        const normalized = parseJSON(inputs.inputMapping, inputs.inputMapping)

        if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
          // Custom blocks key their mapping by the source field's stable id so a
          // rename never orphans the consumer's value; remap id → current name
          // before the child (which is addressed by name) receives it.
          const remapped = isCustomBlock
            ? remapCustomBlockInputKeys(
                normalized as Record<string, unknown>,
                childWorkflow.rawBlocks || {}
              )
            : (normalized as Record<string, unknown>)

          const cleanedMapping = await lazyCleanupInputMapping(
            ctx.workflowId || 'unknown',
            block.id,
            remapped,
            childWorkflow.rawBlocks || {}
          )
          childWorkflowInput = cleanedMapping as Record<string, any>
        } else {
          childWorkflowInput = {}
        }
      } else if (inputs.input !== undefined) {
        childWorkflowInput = inputs.input
      }

      const childSnapshotResult = await snapshotService.createSnapshotWithDeduplication(
        workflowId,
        childWorkflow.workflowState
      )
      childWorkflowSnapshotId = childSnapshotResult.snapshot.id

      const childDepth = (ctx.childWorkflowContext?.depth ?? 0) + 1
      const shouldPropagateCallbacks = childDepth <= DEFAULTS.MAX_SSE_CHILD_DEPTH

      if (!shouldPropagateCallbacks) {
        logger.info('Dropping SSE callbacks beyond max child depth', {
          childDepth,
          maxDepth: DEFAULTS.MAX_SSE_CHILD_DEPTH,
          childWorkflowName,
        })
      }

      if (shouldPropagateCallbacks) {
        const effectiveBlockId = nodeMetadata
          ? (nodeMetadata.originalBlockId ?? nodeMetadata.nodeId)
          : block.id
        const iterationContext = nodeMetadata ? getIterationContext(ctx, nodeMetadata) : undefined
        await ctx.onChildWorkflowInstanceReady?.(
          effectiveBlockId,
          instanceId,
          iterationContext,
          nodeMetadata?.executionOrder,
          ctx.childWorkflowContext
        )
      }

      // A custom block is an invocation boundary: the child runs under the SOURCE
      // workflow owner's identity, workspace, and environment — not the consumer's —
      // so it resolves credentials/integrations/env exactly as published and the
      // consumer needs no access to any of them. (Billing still lands on the
      // consumer's org, aggregated onto the block above.) Regular workflow blocks
      // keep running in the parent's context.
      let childUserId = ctx.userId
      let childWorkspaceId = ctx.workspaceId
      let childEnvVarValues = ctx.environmentVariables
      if (isCustomBlock) {
        if (!loadUserId) {
          throw new Error('Custom block source workflow has no owner')
        }
        if (!childWorkflow.workspaceId) {
          throw new Error('Custom block source workflow has no workspace')
        }
        childUserId = loadUserId
        childWorkspaceId = childWorkflow.workspaceId
        const ownerEnv = await getPersonalAndWorkspaceEnv(loadUserId, childWorkflow.workspaceId)
        childEnvVarValues = { ...ownerEnv.personalDecrypted, ...ownerEnv.workspaceDecrypted }
      }

      const subExecutor = new Executor({
        workflow: childWorkflow.serializedState,
        workflowInput: childWorkflowInput,
        envVarValues: childEnvVarValues,
        workflowVariables: childWorkflow.variables || {},
        contextExtensions: {
          isChildExecution: true,
          // Custom blocks always run the source's latest deployment, so the child
          // context must be deployed too — otherwise its metadata treats the
          // deployed graph as draft. `useDeployed` folds in the custom-block case.
          isDeployedContext: useDeployed,
          enforceCredentialAccess: ctx.enforceCredentialAccess,
          workspaceId: childWorkspaceId,
          userId: childUserId,
          executionId: ctx.executionId,
          abortSignal: ctx.abortSignal,
          // Propagate in-flight block-output redaction into child workflows so
          // nested blocks mask outputs too (recurses: each child forwards it).
          piiBlockOutputRedaction: ctx.piiBlockOutputRedaction,
          callChain: childCallChain,
          ...(shouldPropagateCallbacks && {
            onBlockStart: ctx.onBlockStart,
            onBlockComplete: ctx.onBlockComplete,
            onStream: ctx.onStream,
            onChildWorkflowInstanceReady: ctx.onChildWorkflowInstanceReady,
            childWorkflowContext: {
              parentBlockId: instanceId,
              workflowName: childWorkflowName,
              workflowId,
              depth: childDepth,
            },
          }),
        },
      })

      const startTime = performance.now()

      const result = await subExecutor.execute(workflowId)
      const executionResult = this.toExecutionResult(result)
      const duration = performance.now() - startTime

      logger.info(`Child workflow ${childWorkflowName} completed in ${Math.round(duration)}ms`, {
        success: executionResult.success,
        hasLogs: (executionResult.logs?.length ?? 0) > 0,
      })

      const childTraceSpans = this.captureChildWorkflowLogs(executionResult, childWorkflowName, ctx)

      const mappedResult = this.mapChildOutputToParent(
        executionResult,
        workflowId,
        childWorkflowName,
        duration,
        instanceId,
        childTraceSpans,
        childWorkflowSnapshotId
      )

      // Custom blocks expose only curated outputs — never the child workflow id,
      // name, or trace spans. `mapChildOutputToParent` above still runs so failures
      // surface identically; we just reshape the successful output.
      if (isCustomBlock) {
        // The child's spans are stripped for privacy, but they're the only carrier
        // of the run's cost into billing — so roll their aggregate cost onto the
        // block itself. Custom blocks are org-scoped, so this bills the same org the
        // source workflow would bill if run directly, exactly as if it ran the key.
        const childCost = aggregateChildCost(childTraceSpans)
        return this.projectCustomBlockOutput(executionResult, exposedOutputs, childCost)
      }

      return mappedResult
    } catch (error: unknown) {
      logger.error(`Error executing child workflow ${workflowId}:`, error)

      // Custom blocks are an invocation boundary: on failure the consumer must not
      // see the source workflow's name, nested error text (which names internal
      // blocks), trace spans, or execution result — the success path hides all of
      // these too. The real error is logged above for the publisher/ops; the
      // consumer gets only a generic failure attributed to the block they placed.
      // But a child that failed AFTER consuming hosted keys still owes that spend,
      // so capture the child's spans server-side, distill to the aggregate cost, and
      // carry only that (no internals) so `block-executor` still bills it.
      if (isCustomBlock) {
        let failedChildSpans: WorkflowTraceSpan[] = []
        if (hasExecutionResult(error) && error.executionResult.logs) {
          failedChildSpans = this.captureChildWorkflowLogs(
            error.executionResult,
            childWorkflowName,
            ctx
          )
        } else if (ChildWorkflowError.isChildWorkflowError(error)) {
          failedChildSpans = error.childTraceSpans
        }
        const blockName = block.metadata?.name || 'Custom block'
        throw new ChildWorkflowError({
          message: 'Custom block execution failed',
          childWorkflowName: blockName,
          childTraceSpans: buildCostCarrierSpans(
            aggregateChildCost(failedChildSpans),
            blockName,
            block.metadata?.id ?? 'custom_block'
          ),
          childWorkflowInstanceId: instanceId,
        })
      }

      let childTraceSpans: WorkflowTraceSpan[] = []
      let executionResult: ExecutionResult | undefined

      if (hasExecutionResult(error) && error.executionResult.logs) {
        executionResult = error.executionResult

        logger.info(`Extracting child trace spans from error.executionResult`, {
          hasLogs: (executionResult.logs?.length ?? 0) > 0,
          logCount: executionResult.logs?.length ?? 0,
        })

        childTraceSpans = this.captureChildWorkflowLogs(executionResult, childWorkflowName, ctx)

        logger.info(`Captured ${childTraceSpans.length} child trace spans from failed execution`)
      } else if (ChildWorkflowError.isChildWorkflowError(error)) {
        childTraceSpans = error.childTraceSpans
      }

      // Build a cleaner error message for nested workflow errors
      const errorMessage = this.buildNestedWorkflowErrorMessage(childWorkflowName, error)

      throw new ChildWorkflowError({
        message: errorMessage,
        childWorkflowName,
        childTraceSpans,
        executionResult,
        childWorkflowSnapshotId,
        childWorkflowInstanceId: instanceId,
        cause: error instanceof Error ? error : undefined,
      })
    }
  }

  /**
   * Builds a cleaner error message for nested workflow errors.
   * Parses nested error messages to extract workflow chain and root error.
   */
  private buildNestedWorkflowErrorMessage(childWorkflowName: string, error: unknown): string {
    const originalError = getErrorMessage(error, 'Unknown error')

    // Extract any nested workflow names from the error message
    const { chain, rootError } = this.parseNestedWorkflowError(originalError)

    // Add current workflow to the beginning of the chain
    chain.unshift(childWorkflowName)

    // If we have a chain (nested workflows), format nicely
    if (chain.length > 1) {
      return `Workflow chain: ${chain.join(' → ')} | ${rootError}`
    }

    // Single workflow failure
    return `"${childWorkflowName}" failed: ${rootError}`
  }

  /**
   * Parses a potentially nested workflow error message to extract:
   * - The chain of workflow names
   * - The actual root error message (preserving the block name prefix for the failing block)
   *
   * Handles formats like:
   * - "workflow-name" failed: error
   * - Block Name: "workflow-name" failed: error
   * - Workflow chain: A → B | error
   */
  private parseNestedWorkflowError(message: string): { chain: string[]; rootError: string } {
    const chain: string[] = []
    const remaining = message

    // First, check if it's already in chain format
    const chainMatch = remaining.match(/^Workflow chain: (.+?) \| (.+)$/)
    if (chainMatch) {
      const chainPart = chainMatch[1]
      const errorPart = chainMatch[2]
      chain.push(...chainPart.split(' → ').map((s) => s.trim()))
      return { chain, rootError: errorPart }
    }

    // Extract workflow names from patterns like:
    // - "workflow-name" failed:
    // - Block Name: "workflow-name" failed:
    const workflowPattern = /(?:\[[^\]]+\]\s*)?(?:[^:]+:\s*)?"([^"]+)"\s*failed:\s*/g
    let match: RegExpExecArray | null
    let lastIndex = 0

    match = workflowPattern.exec(remaining)
    while (match !== null) {
      chain.push(match[1])
      lastIndex = match.index + match[0].length
      match = workflowPattern.exec(remaining)
    }

    // The root error is everything after the last match
    // Keep the block name prefix (e.g., Function 1:) so we know which block failed
    const rootError = lastIndex > 0 ? remaining.slice(lastIndex) : remaining

    return { chain, rootError: rootError.trim() || 'Unknown error' }
  }

  /**
   * Ensures the child workflow belongs to the same workspace as the executing
   * context before any child execution starts. Blocks silent cross-workspace
   * execution (e.g. a manual workflow id still pointing at the source
   * workspace after a fork), which would otherwise run the foreign workflow
   * with the parent workspace's environment and billing. Fails closed when the
   * executing context carries no workspace id: every server execution path
   * populates it via execution-core, so a missing value indicates a context
   * that must not silently bypass the check. The error message intentionally
   * omits the foreign workspace id.
   */
  private assertChildWorkflowInWorkspace(
    childWorkflowId: string,
    childWorkspaceId: string | null | undefined,
    parentWorkspaceId: string | undefined
  ): void {
    if (!parentWorkspaceId) {
      throw new Error(
        `Cannot execute child workflow ${childWorkflowId}: executing context has no workspace`
      )
    }
    if (childWorkspaceId !== parentWorkspaceId) {
      throw new Error(
        `Child workflow ${childWorkflowId} belongs to a different workspace and cannot be executed`
      )
    }
  }

  private async loadChildWorkflow(workflowId: string, userId?: string) {
    const headers = await buildAuthHeaders(userId)
    const url = buildAPIUrl(`/api/workflows/${workflowId}`)

    const response = await fetch(url.toString(), { headers })

    if (!response.ok) {
      await response.text().catch(() => {})
      if (response.status === HTTP.STATUS.NOT_FOUND) {
        logger.warn(`Child workflow ${workflowId} not found`)
        return null
      }
      throw new Error(`Failed to fetch workflow: ${response.status} ${response.statusText}`)
    }

    const { data: workflowData } = await response.json()

    if (!workflowData) {
      throw new Error(`Child workflow ${workflowId} returned empty data`)
    }

    logger.info(`Loaded child workflow: ${workflowData.name} (${workflowId})`)
    const workflowState = workflowData.state

    if (!workflowState || !workflowState.blocks) {
      throw new Error(`Child workflow ${workflowId} has invalid state`)
    }

    const serializedWorkflow = this.serializer.serializeWorkflow(
      workflowState.blocks,
      workflowState.edges || [],
      workflowState.loops || {},
      workflowState.parallels || {},
      true
    )

    const workflowVariables = (workflowData.variables as Record<string, any>) || {}
    const workflowStateWithVariables = {
      ...workflowState,
      variables: workflowVariables,
      metadata: {
        ...(workflowState.metadata || {}),
        name: workflowData.name || DEFAULTS.WORKFLOW_NAME,
      },
    }

    if (Object.keys(workflowVariables).length > 0) {
      logger.info(
        `Loaded ${Object.keys(workflowVariables).length} variables for child workflow: ${workflowId}`
      )
    }

    return {
      name: workflowData.name,
      workspaceId: (workflowData.workspaceId ?? null) as string | null,
      serializedState: serializedWorkflow,
      variables: workflowVariables,
      workflowState: workflowStateWithVariables,
      rawBlocks: workflowState.blocks,
    }
  }

  private async checkChildDeployment(workflowId: string, userId?: string): Promise<boolean> {
    try {
      const headers = await buildAuthHeaders(userId)
      const url = buildAPIUrl(`/api/workflows/${workflowId}/deployed`)

      const response = await fetch(url.toString(), {
        headers,
        cache: 'no-store',
      })

      if (!response.ok) return false

      const json = await response.json()
      return !!json?.data?.deployedState || !!json?.deployedState
    } catch (e) {
      logger.error(`Failed to check child deployment for ${workflowId}:`, e)
      return false
    }
  }

  private async loadChildWorkflowDeployed(workflowId: string, userId?: string) {
    const headers = await buildAuthHeaders(userId)
    const deployedUrl = buildAPIUrl(`/api/workflows/${workflowId}/deployed`)

    const deployedRes = await fetch(deployedUrl.toString(), {
      headers,
      cache: 'no-store',
    })

    if (!deployedRes.ok) {
      if (deployedRes.status === HTTP.STATUS.NOT_FOUND) {
        return null
      }
      throw new Error(
        `Failed to fetch deployed workflow: ${deployedRes.status} ${deployedRes.statusText}`
      )
    }
    const deployedJson = await deployedRes.json()
    const deployedState = deployedJson?.data?.deployedState || deployedJson?.deployedState
    if (!deployedState || !deployedState.blocks) {
      throw new Error(`Deployed state missing or invalid for child workflow ${workflowId}`)
    }

    const metaUrl = buildAPIUrl(`/api/workflows/${workflowId}`)
    const metaRes = await fetch(metaUrl.toString(), {
      headers,
      cache: 'no-store',
    })

    if (!metaRes.ok) {
      throw new Error(`Failed to fetch workflow metadata: ${metaRes.status} ${metaRes.statusText}`)
    }
    const metaJson = await metaRes.json()
    const wfData = metaJson?.data

    const serializedWorkflow = this.serializer.serializeWorkflow(
      deployedState.blocks,
      deployedState.edges || [],
      deployedState.loops || {},
      deployedState.parallels || {},
      true
    )

    const workflowVariables = (wfData?.variables as Record<string, any>) || {}
    const childName = wfData?.name || DEFAULTS.WORKFLOW_NAME
    const workflowStateWithVariables = {
      ...deployedState,
      variables: workflowVariables,
      metadata: {
        ...(deployedState.metadata || {}),
        name: childName,
      },
    }

    return {
      name: childName,
      workspaceId: (wfData?.workspaceId ?? null) as string | null,
      serializedState: serializedWorkflow,
      variables: workflowVariables,
      workflowState: workflowStateWithVariables,
      rawBlocks: deployedState.blocks,
    }
  }

  /**
   * Captures and transforms child workflow logs into trace spans
   */
  private captureChildWorkflowLogs(
    childResult: ExecutionResult,
    childWorkflowName: string,
    parentContext: ExecutionContext
  ): WorkflowTraceSpan[] {
    try {
      if (!childResult.logs || !Array.isArray(childResult.logs)) {
        return []
      }

      const { traceSpans } = buildTraceSpans(childResult)

      if (!traceSpans || traceSpans.length === 0) {
        return []
      }

      const processedSpans = this.processChildWorkflowSpans(traceSpans)

      if (processedSpans.length === 0) {
        return []
      }

      const transformedSpans = processedSpans.map((span) =>
        this.transformSpanForChildWorkflow(span, childWorkflowName)
      )

      return transformedSpans
    } catch (error) {
      logger.error(`Error capturing child workflow logs for ${childWorkflowName}:`, error)
      return []
    }
  }

  private transformSpanForChildWorkflow(
    span: WorkflowTraceSpan,
    childWorkflowName: string
  ): WorkflowTraceSpan {
    const metadata: Record<string, unknown> = {
      ...(span.metadata ?? {}),
      isFromChildWorkflow: true,
      childWorkflowName,
    }

    const transformedChildren = Array.isArray(span.children)
      ? span.children.map((childSpan) =>
          this.transformSpanForChildWorkflow(childSpan, childWorkflowName)
        )
      : undefined

    return {
      ...span,
      metadata,
      ...(transformedChildren ? { children: transformedChildren } : {}),
    }
  }

  private processChildWorkflowSpans(spans: TraceSpan[]): WorkflowTraceSpan[] {
    const processed: WorkflowTraceSpan[] = []

    spans.forEach((span) => {
      if (this.isSyntheticWorkflowWrapper(span)) {
        if (span.children && Array.isArray(span.children)) {
          processed.push(...this.processChildWorkflowSpans(span.children))
        }
        return
      }

      const workflowSpan: WorkflowTraceSpan = {
        ...span,
      }

      if (Array.isArray(workflowSpan.children)) {
        workflowSpan.children = this.processChildWorkflowSpans(workflowSpan.children as TraceSpan[])
      }

      processed.push(workflowSpan)
    })

    return processed
  }

  private toExecutionResult(result: ExecutionResult | StreamingExecution): ExecutionResult {
    return 'execution' in result ? result.execution : result
  }

  private isSyntheticWorkflowWrapper(span: TraceSpan | undefined): boolean {
    if (!span || span.type !== 'workflow') return false
    return !span.blockId
  }

  /**
   * Shape a custom block's successful output. With curated `exposedOutputs`, each
   * maps a child block output (blockId + dot-path, read from the child's per-block
   * logs) to a named top-level field. With none, exposes the child's whole
   * `result`. Never leaks child workflow id/name/trace spans.
   */
  private projectCustomBlockOutput(
    executionResult: ExecutionResult,
    exposedOutputs: CustomBlockOutput[],
    childCost: number
  ): BlockOutput {
    // Aggregate child cost only (never the child's spans/model breakdown) so the
    // run is billed while the source workflow's internals stay hidden.
    const cost = childCost > 0 ? { cost: { total: childCost } } : {}
    if (exposedOutputs.length === 0) {
      return { success: true, result: executionResult.output ?? {}, ...cost }
    }
    const logs = executionResult.logs ?? []
    const output: Record<string, unknown> = { success: true, ...cost }
    for (const { blockId, path, name } of exposedOutputs) {
      const log =
        [...logs].reverse().find((l) => l.blockId === blockId && l.success) ??
        [...logs].reverse().find((l) => l.blockId === blockId)
      output[name] = log ? getValueAtPath(log.output, path) : undefined
    }
    return output as BlockOutput
  }

  private mapChildOutputToParent(
    childResult: ExecutionResult,
    childWorkflowId: string,
    childWorkflowName: string,
    duration: number,
    instanceId: string,
    childTraceSpans?: WorkflowTraceSpan[],
    childWorkflowSnapshotId?: string
  ): BlockOutput {
    const success = childResult.success !== false
    const result = childResult.output || {}

    if (!success) {
      logger.warn(`Child workflow ${childWorkflowName} failed`)
      throw new ChildWorkflowError({
        message: `"${childWorkflowName}" failed: ${childResult.error || 'Child workflow execution failed'}`,
        childWorkflowName,
        childTraceSpans: childTraceSpans || [],
        childWorkflowSnapshotId,
        childWorkflowInstanceId: instanceId,
      })
    }

    const output: BlockOutput = {
      success: true,
      childWorkflowName,
      childWorkflowId,
      ...(childWorkflowSnapshotId ? { childWorkflowSnapshotId } : {}),
      result,
      childTraceSpans: childTraceSpans || [],
      _childWorkflowInstanceId: instanceId,
    }
    return output
  }
}
