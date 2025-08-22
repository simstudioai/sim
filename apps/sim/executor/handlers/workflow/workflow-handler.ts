import { generateInternalToken } from '@/lib/auth/internal'
import { createLogger } from '@/lib/logs/console/logger'
import { buildTraceSpans } from '@/lib/logs/execution/trace-spans/trace-spans'
import { getBaseUrl } from '@/lib/urls/utils'
import type { BlockOutput } from '@/blocks/types'
import { Executor } from '@/executor'
import { BlockType } from '@/executor/consts'
import type { BlockHandler, ExecutionContext, StreamingExecution } from '@/executor/types'
import { Serializer } from '@/serializer'
import type { SerializedBlock } from '@/serializer/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('WorkflowBlockHandler')

// Maximum allowed depth for nested workflow executions
const MAX_WORKFLOW_DEPTH = 10

/**
 * Handler for workflow blocks that execute other workflows inline.
 * Creates sub-execution contexts and manages data flow between parent and child workflows.
 */
export class WorkflowBlockHandler implements BlockHandler {
  private serializer = new Serializer()
  private static executionStack = new Set<string>()

  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === BlockType.WORKFLOW
  }

  async execute(
    block: SerializedBlock,
    inputs: Record<string, any>,
    context: ExecutionContext
  ): Promise<BlockOutput | StreamingExecution> {
    logger.info(`Executing workflow block: ${block.id}`)

    const workflowId = inputs.workflowId

    if (!workflowId) {
      throw new Error('No workflow selected for execution')
    }

    try {
      // Check execution depth
      const currentDepth = (context.workflowId?.split('_sub_').length || 1) - 1
      if (currentDepth >= MAX_WORKFLOW_DEPTH) {
        throw new Error(`Maximum workflow nesting depth of ${MAX_WORKFLOW_DEPTH} exceeded`)
      }

      // Check for cycles - include block ID to differentiate parallel executions
      const executionId = `${context.workflowId}_sub_${workflowId}_${block.id}`
      if (WorkflowBlockHandler.executionStack.has(executionId)) {
        throw new Error(`Cyclic workflow dependency detected: ${executionId}`)
      }

      // Add current execution to stack
      WorkflowBlockHandler.executionStack.add(executionId)

      // Load the child workflow from API
      const childWorkflow = await this.loadChildWorkflow(workflowId)

      if (!childWorkflow) {
        throw new Error(`Child workflow ${workflowId} not found`)
      }

      // Get workflow metadata for logging
      const { workflows } = useWorkflowRegistry.getState()
      const workflowMetadata = workflows[workflowId]
      const childWorkflowName = workflowMetadata?.name || childWorkflow.name || 'Unknown Workflow'

      logger.info(
        `Executing child workflow: ${childWorkflowName} (${workflowId}) at depth ${currentDepth}`
      )

      // Prepare the input for the child workflow
      // The input from this block should be passed as start.input to the child workflow
      let childWorkflowInput = {}

      if (inputs.input !== undefined) {
        // If input is provided, use it directly
        childWorkflowInput = inputs.input
        logger.info(`Passing input to child workflow: ${JSON.stringify(childWorkflowInput)}`)
      }

      // Remove the workflowId from the input to avoid confusion
      const { workflowId: _, input: __, ...otherInputs } = inputs

      // Execute child workflow inline
      const subExecutor = new Executor({
        workflow: childWorkflow.serializedState,
        workflowInput: childWorkflowInput,
        envVarValues: context.environmentVariables,
        workflowVariables: childWorkflow.variables || {},
        contextExtensions: {
          isChildExecution: true, // Prevent child executor from managing global state
        },
      })

      const startTime = performance.now()
      // Use the actual child workflow ID for authentication, not the execution ID
      // This ensures knowledge base and other API calls can properly authenticate
      const result = await subExecutor.execute(workflowId)
      const duration = performance.now() - startTime

      // Remove current execution from stack after completion
      WorkflowBlockHandler.executionStack.delete(executionId)

      logger.info(`Child workflow ${childWorkflowName} completed in ${Math.round(duration)}ms`)

      const childTraceSpans = this.captureChildWorkflowLogs(result, childWorkflowName, context)
      const mappedResult = this.mapChildOutputToParent(
        result,
        workflowId,
        childWorkflowName,
        duration,
        childTraceSpans
      )

      if ((mappedResult as any).success === false) {
        const childError = (mappedResult as any).error || 'Unknown error'
        const errorWithSpans = new Error(
          `Error in child workflow "${childWorkflowName}": ${childError}`
        ) as any
        // Attach trace spans and name for higher-level logging to consume
        errorWithSpans.childTraceSpans = childTraceSpans
        errorWithSpans.childWorkflowName = childWorkflowName
        throw errorWithSpans
      }

      return mappedResult
    } catch (error: any) {
      logger.error(`Error executing child workflow ${workflowId}:`, error)

      const executionId = `${context.workflowId}_sub_${workflowId}_${block.id}`
      WorkflowBlockHandler.executionStack.delete(executionId)
      const { workflows } = useWorkflowRegistry.getState()
      const workflowMetadata = workflows[workflowId]
      const childWorkflowName = workflowMetadata?.name || workflowId

      const originalError = error.message || 'Unknown error'
      if (originalError.startsWith('Error in child workflow')) {
        throw error // Re-throw as-is to avoid duplication
      }

      throw new Error(`Error in child workflow "${childWorkflowName}": ${originalError}`)
    }
  }

  /**
   * Loads a child workflow from the API
   */
  private async loadChildWorkflow(workflowId: string) {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (typeof window === 'undefined') {
        const token = await generateInternalToken()
        headers.Authorization = `Bearer ${token}`
      }

      const response = await fetch(`${getBaseUrl()}/api/workflows/${workflowId}`, {
        headers,
      })

      if (!response.ok) {
        if (response.status === 404) {
          logger.error(`Child workflow ${workflowId} not found`)
          return null
        }
        throw new Error(`Failed to fetch workflow: ${response.status} ${response.statusText}`)
      }

      const { data: workflowData } = await response.json()

      if (!workflowData) {
        logger.error(`Child workflow ${workflowId} returned empty data`)
        return null
      }

      logger.info(`Loaded child workflow: ${workflowData.name} (${workflowId})`)
      const workflowState = workflowData.state

      if (!workflowState || !workflowState.blocks) {
        logger.error(`Child workflow ${workflowId} has invalid state`)
        return null
      }
      const serializedWorkflow = this.serializer.serializeWorkflow(
        workflowState.blocks,
        workflowState.edges || [],
        workflowState.loops || {},
        workflowState.parallels || {},
        true // Enable validation during execution
      )

      const workflowVariables = (workflowData.variables as Record<string, any>) || {}

      if (Object.keys(workflowVariables).length > 0) {
        logger.info(
          `Loaded ${Object.keys(workflowVariables).length} variables for child workflow: ${workflowId}`
        )
      } else {
        logger.debug(`No workflow variables found for child workflow: ${workflowId}`)
      }

      return {
        name: workflowData.name,
        serializedState: serializedWorkflow,
        variables: workflowVariables,
      }
    } catch (error) {
      logger.error(`Error loading child workflow ${workflowId}:`, error)
      return null
    }
  }

  /**
   * Captures and transforms child workflow logs into trace spans
   */
  private captureChildWorkflowLogs(
    childResult: any,
    childWorkflowName: string,
    parentContext: ExecutionContext
  ): any[] {
    try {
      if (!childResult.logs || !Array.isArray(childResult.logs)) {
        return []
      }

      const { traceSpans } = buildTraceSpans(childResult)

      if (!traceSpans || traceSpans.length === 0) {
        return []
      }

      const transformedSpans = traceSpans.map((span: any) => {
        return this.transformSpanForChildWorkflow(span, childWorkflowName)
      })

      return transformedSpans
    } catch (error) {
      logger.error(`Error capturing child workflow logs for ${childWorkflowName}:`, error)
      return []
    }
  }

  /**
   * Transforms trace span for child workflow context
   */
  private transformSpanForChildWorkflow(span: any, childWorkflowName: string): any {
    const transformedSpan = {
      ...span,
      name: this.cleanChildSpanName(span.name, childWorkflowName),
      metadata: {
        ...span.metadata,
        isFromChildWorkflow: true,
        childWorkflowName,
      },
    }

    if (span.children && Array.isArray(span.children)) {
      transformedSpan.children = span.children.map((childSpan: any) =>
        this.transformSpanForChildWorkflow(childSpan, childWorkflowName)
      )
    }

    if (span.output?.childTraceSpans) {
      transformedSpan.output = {
        ...transformedSpan.output,
        childTraceSpans: span.output.childTraceSpans,
      }
    }

    return transformedSpan
  }

  /**
   * Cleans up child span names for readability
   */
  private cleanChildSpanName(spanName: string, childWorkflowName: string): string {
    if (spanName.includes(`${childWorkflowName}:`)) {
      const cleanName = spanName.replace(`${childWorkflowName}:`, '').trim()

      if (cleanName === 'Workflow Execution') {
        return `${childWorkflowName} workflow`
      }

      if (cleanName.startsWith('Agent ')) {
        return `${cleanName}`
      }

      return `${cleanName}`
    }

    if (spanName === 'Workflow Execution') {
      return `${childWorkflowName} workflow`
    }

    return `${spanName}`
  }

  /**
   * Maps child workflow output to parent block output
   */
  private mapChildOutputToParent(
    childResult: any,
    childWorkflowId: string,
    childWorkflowName: string,
    duration: number,
    childTraceSpans?: any[]
  ): BlockOutput {
    const success = childResult.success !== false
    if (!success) {
      logger.warn(`Child workflow ${childWorkflowName} failed`)
      const failure: Record<string, any> = {
        success: false,
        childWorkflowName,
        error: childResult.error || 'Child workflow execution failed',
      }
      // Only include spans when present to keep output stable for callers/tests
      if (Array.isArray(childTraceSpans) && childTraceSpans.length > 0) {
        failure.childTraceSpans = childTraceSpans
      }
      return failure as Record<string, any>
    }
    let result = childResult
    if (childResult?.output) {
      result = childResult.output
    }
    return {
      success: true,
      childWorkflowName,
      result,
      childTraceSpans: childTraceSpans || [],
    } as Record<string, any>
  }
}
