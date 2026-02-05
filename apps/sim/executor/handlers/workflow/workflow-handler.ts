import { createLogger } from '@sim/logger'
import { snapshotService } from '@/lib/logs/execution/snapshot/service'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import type { TraceSpan } from '@/lib/logs/types'
import type { BlockOutput } from '@/blocks/types'
import { Executor } from '@/executor'
import { BlockType, DEFAULTS, HTTP } from '@/executor/constants'
import { ChildWorkflowError } from '@/executor/errors/child-workflow-error'
import type {
  BlockHandler,
  ExecutionContext,
  ExecutionResult,
  StreamingExecution,
} from '@/executor/types'
import { hasExecutionResult } from '@/executor/utils/errors'
import { buildAPIUrl, buildAuthHeaders } from '@/executor/utils/http'
import { parseJSON } from '@/executor/utils/json'
import { lazyCleanupInputMapping } from '@/executor/utils/lazy-cleanup'
import { Serializer } from '@/serializer'
import type { SerializedBlock } from '@/serializer/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkflowBlockHandler')

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
    return id === BlockType.WORKFLOW || id === BlockType.WORKFLOW_INPUT
  }

  async execute(
    ctx: ExecutionContext,
    block: SerializedBlock,
    inputs: Record<string, any>
  ): Promise<BlockOutput | StreamingExecution> {
    logger.info(`Executing workflow block: ${block.id}`)

    const workflowId = inputs.workflowId

    if (!workflowId) {
      throw new Error('No workflow selected for execution')
    }

    // Initialize with registry name, will be updated with loaded workflow name
    const { workflows } = useWorkflowRegistry.getState()
    const workflowMetadata = workflows[workflowId]
    let childWorkflowName = workflowMetadata?.name || workflowId

    let childWorkflowSnapshotId: string | undefined
    try {
      const currentDepth = (ctx.workflowId?.split('_sub_').length || 1) - 1
      if (currentDepth >= DEFAULTS.MAX_WORKFLOW_DEPTH) {
        throw new Error(`Maximum workflow nesting depth of ${DEFAULTS.MAX_WORKFLOW_DEPTH} exceeded`)
      }

      if (ctx.isDeployedContext) {
        const hasActiveDeployment = await this.checkChildDeployment(workflowId)
        if (!hasActiveDeployment) {
          throw new Error(
            `Child workflow is not deployed. Please deploy the workflow before invoking it.`
          )
        }
      }

      const childWorkflow = ctx.isDeployedContext
        ? await this.loadChildWorkflowDeployed(workflowId)
        : await this.loadChildWorkflow(workflowId)

      if (!childWorkflow) {
        throw new Error(`Child workflow ${workflowId} not found`)
      }

      // Update with loaded workflow name (more reliable than registry)
      childWorkflowName = workflowMetadata?.name || childWorkflow.name || 'Unknown Workflow'

      logger.info(
        `Executing child workflow: ${childWorkflowName} (${workflowId}) at depth ${currentDepth}`
      )

      let childWorkflowInput: Record<string, any> = {}

      if (inputs.inputMapping !== undefined && inputs.inputMapping !== null) {
        const normalized = parseJSON(inputs.inputMapping, inputs.inputMapping)

        if (normalized && typeof normalized === 'object' && !Array.isArray(normalized)) {
          const cleanedMapping = await lazyCleanupInputMapping(
            ctx.workflowId || 'unknown',
            block.id,
            normalized,
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

      const subExecutor = new Executor({
        workflow: childWorkflow.serializedState,
        workflowInput: childWorkflowInput,
        envVarValues: ctx.environmentVariables,
        workflowVariables: childWorkflow.variables || {},
        contextExtensions: {
          isChildExecution: true,
          isDeployedContext: ctx.isDeployedContext === true,
          workspaceId: ctx.workspaceId,
          userId: ctx.userId,
          executionId: ctx.executionId,
          abortSignal: ctx.abortSignal,
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
        childTraceSpans,
        childWorkflowSnapshotId
      )

      return mappedResult
    } catch (error: unknown) {
      logger.error(`Error executing child workflow ${workflowId}:`, error)

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
        cause: error instanceof Error ? error : undefined,
      })
    }
  }

  /**
   * Builds a cleaner error message for nested workflow errors.
   * Parses nested error messages to extract workflow chain and root error.
   */
  private buildNestedWorkflowErrorMessage(childWorkflowName: string, error: unknown): string {
    const originalError = error instanceof Error ? error.message : 'Unknown error'

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

  private async loadChildWorkflow(workflowId: string) {
    const headers = await buildAuthHeaders()
    const url = buildAPIUrl(`/api/workflows/${workflowId}`)

    const response = await fetch(url.toString(), { headers })

    if (!response.ok) {
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
    }

    if (Object.keys(workflowVariables).length > 0) {
      logger.info(
        `Loaded ${Object.keys(workflowVariables).length} variables for child workflow: ${workflowId}`
      )
    }

    return {
      name: workflowData.name,
      serializedState: serializedWorkflow,
      variables: workflowVariables,
      workflowState: workflowStateWithVariables,
      rawBlocks: workflowState.blocks,
    }
  }

  private async checkChildDeployment(workflowId: string): Promise<boolean> {
    try {
      const headers = await buildAuthHeaders()
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

  private async loadChildWorkflowDeployed(workflowId: string) {
    const headers = await buildAuthHeaders()
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
    const workflowStateWithVariables = {
      ...deployedState,
      variables: workflowVariables,
    }

    return {
      name: wfData?.name || DEFAULTS.WORKFLOW_NAME,
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

  private flattenChildWorkflowSpans(spans: TraceSpan[]): WorkflowTraceSpan[] {
    const flattened: WorkflowTraceSpan[] = []

    spans.forEach((span) => {
      if (this.isSyntheticWorkflowWrapper(span)) {
        if (span.children && Array.isArray(span.children)) {
          flattened.push(...this.flattenChildWorkflowSpans(span.children))
        }
        return
      }

      const workflowSpan: WorkflowTraceSpan = {
        ...span,
      }

      if (Array.isArray(workflowSpan.children)) {
        const childSpans = workflowSpan.children as TraceSpan[]
        workflowSpan.children = this.flattenChildWorkflowSpans(childSpans)
      }

      if (workflowSpan.output && typeof workflowSpan.output === 'object') {
        const { childTraceSpans: nestedChildSpans, ...outputRest } = workflowSpan.output as {
          childTraceSpans?: TraceSpan[]
        } & Record<string, unknown>

        if (Array.isArray(nestedChildSpans) && nestedChildSpans.length > 0) {
          const flattenedNestedChildren = this.flattenChildWorkflowSpans(nestedChildSpans)
          workflowSpan.children = [...(workflowSpan.children || []), ...flattenedNestedChildren]
        }

        workflowSpan.output = outputRest
      }

      flattened.push(workflowSpan)
    })

    return flattened
  }

  private toExecutionResult(result: ExecutionResult | StreamingExecution): ExecutionResult {
    return 'execution' in result ? result.execution : result
  }

  private isSyntheticWorkflowWrapper(span: TraceSpan | undefined): boolean {
    if (!span || span.type !== 'workflow') return false
    return !span.blockId
  }

  private mapChildOutputToParent(
    childResult: ExecutionResult,
    childWorkflowId: string,
    childWorkflowName: string,
    duration: number,
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
      })
    }

    return {
      success: true,
      childWorkflowName,
      childWorkflowId,
      ...(childWorkflowSnapshotId ? { childWorkflowSnapshotId } : {}),
      result,
      childTraceSpans: childTraceSpans || [],
    } as Record<string, any>
  }
}
