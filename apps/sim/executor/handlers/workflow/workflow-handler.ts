import { generateInternalToken } from '@/lib/auth/internal'
import { createLogger } from '@/lib/logs/console-logger'
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

      // Check for cycles
      const executionId = `${context.workflowId}_sub_${workflowId}`
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
      })

      const startTime = performance.now()
      const result = await subExecutor.execute(executionId)
      const duration = performance.now() - startTime

      // Remove current execution from stack after completion
      WorkflowBlockHandler.executionStack.delete(executionId)

      // Log execution completion
      logger.info(`Child workflow ${childWorkflowName} completed in ${Math.round(duration)}ms`)

      // Map child workflow output to parent block output
      return this.mapChildOutputToParent(result, workflowId, childWorkflowName, duration)
    } catch (error: any) {
      logger.error(`Error executing child workflow ${workflowId}:`, error)

      // Clean up execution stack in case of error
      const executionId = `${context.workflowId}_sub_${workflowId}`
      WorkflowBlockHandler.executionStack.delete(executionId)

      // Get workflow name for error reporting
      const { workflows } = useWorkflowRegistry.getState()
      const workflowMetadata = workflows[workflowId]
      const childWorkflowName = workflowMetadata?.name || workflowId

      return {
        success: false,
        error: error.message || 'Child workflow execution failed',
        childWorkflowName: childWorkflowName,
      } as Record<string, any>
    }
  }

  /**
   * Loads a child workflow from the API
   */
  private async loadChildWorkflow(workflowId: string) {
    try {
      // Fetch workflow from API with internal authentication header
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }

      // Add internal auth header for server-side calls
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

      // Extract the workflow state (API returns normalized data in state field)
      const workflowState = workflowData.state

      if (!workflowState || !workflowState.blocks) {
        logger.error(`Child workflow ${workflowId} has invalid state`)
        return null
      }

      // Use blocks directly since API returns data from normalized tables
      const serializedWorkflow = this.serializer.serializeWorkflow(
        workflowState.blocks,
        workflowState.edges || [],
        workflowState.loops || {},
        workflowState.parallels || {}
      )

      return {
        name: workflowData.name,
        serializedState: serializedWorkflow,
      }
    } catch (error) {
      logger.error(`Error loading child workflow ${workflowId}:`, error)
      return null
    }
  }

  /**
   * Maps child workflow output to parent block output format
   */
  private mapChildOutputToParent(
    childResult: any,
    childWorkflowId: string,
    childWorkflowName: string,
    duration: number
  ): BlockOutput {
    const success = childResult.success !== false

    // If child workflow failed, return minimal output
    if (!success) {
      logger.warn(`Child workflow ${childWorkflowName} failed`)
      return {
        success: false,
        childWorkflowName,
        error: childResult.error || 'Child workflow execution failed',
      } as Record<string, any>
    }

    // Extract the actual result content from the flattened structure
    let result = childResult
    if (childResult?.output) {
      result = childResult.output
    }

    // Return a properly structured response with all required fields
    return {
      success: true,
      childWorkflowName,
      result,
    } as Record<string, any>
  }
}
