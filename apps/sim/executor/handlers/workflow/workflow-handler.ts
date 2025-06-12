import { createLogger } from '@/lib/logs/console-logger'
import type { BlockOutput } from '@/blocks/types'
import { Serializer } from '@/serializer'
import type { SerializedBlock } from '@/serializer/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { Executor } from '../../index'
import type { BlockHandler, ExecutionContext, StreamingExecution } from '../../types'

const logger = createLogger('WorkflowBlockHandler')

/**
 * Handler for workflow blocks that execute other workflows inline.
 * Creates sub-execution contexts and manages data flow between parent and child workflows.
 */
export class WorkflowBlockHandler implements BlockHandler {
  private serializer = new Serializer()

  canHandle(block: SerializedBlock): boolean {
    return block.metadata?.id === 'workflow'
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
      // Load the child workflow from API
      const childWorkflow = await this.loadChildWorkflow(workflowId)

      if (!childWorkflow) {
        throw new Error(`Child workflow ${workflowId} not found`)
      }

      // Get workflow metadata for logging
      const { workflows } = useWorkflowRegistry.getState()
      const workflowMetadata = workflows[workflowId]
      const childWorkflowName = workflowMetadata?.name || childWorkflow.name || 'Unknown Workflow'

      logger.info(`Executing child workflow: ${childWorkflowName} (${workflowId})`)

      // Use the input data directly from the context - this allows for visual connections
      // from parent workflow blocks to flow into the child workflow
      const subWorkflowInput = {
        ...inputs, // Include any direct inputs to this block
      }

      // Get the starter block's input data from the context
      const starterBlock = context.workflow?.blocks.find((b) => b.metadata?.id === 'starter')
      if (starterBlock) {
        const starterState = context.blockStates.get(starterBlock.id)
        if (starterState?.output?.response?.input) {
          // Include the parent workflow's input data
          Object.assign(subWorkflowInput, starterState.output.response.input)
        }
      }

      // Remove the workflowId from the input to avoid confusion
      const { workflowId: _, ...cleanInput } = subWorkflowInput

      // Execute child workflow inline
      const subExecutor = new Executor({
        workflow: childWorkflow.serializedState,
        workflowInput: cleanInput,
        envVarValues: context.environmentVariables,
      })

      const startTime = performance.now()
      const result = await subExecutor.execute(`${context.workflowId}_sub_${workflowId}`)
      const duration = performance.now() - startTime

      // Log execution completion
      logger.info(`Child workflow ${childWorkflowName} completed in ${Math.round(duration)}ms`)

      // Map child workflow output to parent block output
      return this.mapChildOutputToParent(result, workflowId, childWorkflowName, duration)
    } catch (error: any) {
      logger.error(`Error executing child workflow ${workflowId}:`, error)

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
      // Fetch workflow from API
      const response = await fetch(`/api/workflows/${workflowId}`)

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

      // Extract the workflow state
      const workflowState = workflowData.state

      if (!workflowState || !workflowState.blocks) {
        logger.error(`Child workflow ${workflowId} has invalid state`)
        return null
      }

      // Use blocks directly since DB format should match UI format
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
        response: {
          success: false,
          childWorkflowName,
          error: childResult.error || 'Child workflow execution failed'
        }
      } as Record<string, any>
    }

    // Extract the actual result content from the nested structure
    let result = childResult
    if (childResult?.output?.response) {
      result = childResult.output.response
    } else if (childResult?.response?.response) {
      result = childResult.response.response
    }

    // Return a properly structured response with all required fields
    return {
      response: {
        success: true,
        childWorkflowName,
        result
      }
    } as Record<string, any>
  }
}
