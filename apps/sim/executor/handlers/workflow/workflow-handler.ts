import { generateInternalToken } from '@/lib/auth/internal'
import { createLogger } from '@/lib/logs/console-logger'
import { getBaseUrl } from '@/lib/urls/utils'
import type { BlockOutput } from '@/blocks/types'
import { Executor } from '@/executor'
import { BlockType } from '@/executor/consts'
import type { InputResolver } from '@/executor/resolver/resolver'
import type { BlockHandler, ExecutionContext, StreamingExecution } from '@/executor/types'
import { Serializer } from '@/serializer'
import type { SerializedBlock } from '@/serializer/types'
import { useExecutionStore } from '@/stores/execution/store'
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

  constructor(private resolver?: InputResolver) {}

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
    // Get workflow metadata for error messages
    const { workflows } = useWorkflowRegistry.getState()
    const workflowMetadata = workflows[workflowId]
    const childWorkflowName = workflowMetadata?.name || workflowId

    // Check execution depth
    const currentDepth = (context.workflowId?.split('_sub_').length || 1) - 1
    if (currentDepth >= MAX_WORKFLOW_DEPTH) {
      throw new Error(
        `Child workflow '${childWorkflowName}' failed: Maximum workflow nesting depth of ${MAX_WORKFLOW_DEPTH} exceeded`
      )
    }

    // Check for cycles
    const executionId = `${context.workflowId}_sub_${workflowId}`
    if (WorkflowBlockHandler.executionStack.has(executionId)) {
      throw new Error(
        `Child workflow '${childWorkflowName}' failed: Cyclic workflow dependency detected: ${executionId}`
      )
    }

    // Add current execution to stack
    WorkflowBlockHandler.executionStack.add(executionId)

    // Load the child workflow from API
    const childWorkflow = await this.loadChildWorkflow(workflowId)

    if (!childWorkflow) {
      throw new Error(
        `Child workflow '${childWorkflowName}' failed: Child workflow ${workflowId} not found`
      )
    }

    // Update workflow name with loaded workflow data
    const finalChildWorkflowName =
      workflowMetadata?.name || childWorkflow.name || 'Unknown Workflow'

    logger.info(
      `Executing child workflow: ${finalChildWorkflowName} (${workflowId}) at depth ${currentDepth}`
    )

    // Prepare the input for the child workflow
    // The input from this block should be passed as start.input to the child workflow
    let childWorkflowInput = {}

    // Prioritize JSON input (advanced mode) over structured input format (basic mode)
    if (inputs.jsonInput !== undefined && inputs.jsonInput !== null) {
      // Use JSON input directly (advanced mode)
      try {
        let jsonString =
          typeof inputs.jsonInput === 'string' ? inputs.jsonInput : JSON.stringify(inputs.jsonInput)

        // Resolve variables in the JSON string before parsing
        if (this.resolver) {
          const resolvedVars = this.resolver.resolveVariableReferences(jsonString, block)
          const resolvedRefs = this.resolver.resolveBlockReferences(resolvedVars, context, block)
          jsonString = this.resolver.resolveEnvVariables(resolvedRefs, false)
        }

        childWorkflowInput = JSON.parse(jsonString)
        logger.info(`Passing JSON input to child workflow: ${JSON.stringify(childWorkflowInput)}`)
      } catch (error) {
        logger.error('Failed to parse JSON input:', error)
        throw new Error(
          'Invalid JSON input provided. Please check your JSON syntax and variable references.'
        )
      }
    } else if (inputs.workflowInputFormat && Array.isArray(inputs.workflowInputFormat)) {
      // Use structured input format (basic mode) as fallback
      const formattedInput: Record<string, any> = {}
      for (const field of inputs.workflowInputFormat) {
        if (field.name && field.value !== undefined) {
          let resolvedValue = field.value

          // Resolve variables in field values
          if (this.resolver && typeof field.value === 'string') {
            const resolvedVars = this.resolver.resolveVariableReferences(field.value, block)
            const resolvedRefs = this.resolver.resolveBlockReferences(resolvedVars, context, block)
            resolvedValue = this.resolver.resolveEnvVariables(resolvedRefs, false)
          }

          formattedInput[field.name] = resolvedValue
        }
      }
      childWorkflowInput = formattedInput
      logger.info(
        `Passing structured input to child workflow: ${JSON.stringify(childWorkflowInput)}`
      )
    }

    // Set this workflow block as active during execution
    const { setActiveBlocks } = useExecutionStore.getState()
    const currentActiveBlocks = useExecutionStore.getState().activeBlockIds
    const newActiveBlocks = new Set([...currentActiveBlocks, block.id])
    logger.info(
      `Setting workflow block ${block.id} as active. Current active blocks:`,
      Array.from(currentActiveBlocks)
    )
    setActiveBlocks(newActiveBlocks)

    try {
      // Execute child workflow inline
      logger.info(
        `[WorkflowHandler] Passing input to child workflow: ${JSON.stringify(childWorkflowInput)}`
      )
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
      logger.info(`Child workflow ${finalChildWorkflowName} completed in ${Math.round(duration)}ms`)

      // Aggregate child workflow logs into parent context
      const executionResult = 'execution' in result ? result.execution : result
      if (executionResult.logs && executionResult.logs.length > 0) {
        logger.info(
          `Aggregating ${executionResult.logs.length} logs from child workflow ${finalChildWorkflowName}`
        )
        // Add all child workflow logs to the parent execution context
        context.blockLogs.push(...executionResult.logs)
      }

      // Map child workflow output to parent block output
      return this.mapChildOutputToParent(result, finalChildWorkflowName)
    } catch (error: any) {
      logger.error(`Error executing child workflow ${workflowId}:`, error)

      // Clean up execution stack in case of error
      WorkflowBlockHandler.executionStack.delete(executionId)

      // Re-throw the error with more context instead of wrapping it
      throw new Error(
        `Child workflow '${finalChildWorkflowName}' failed: ${error.message || 'Execution failed'}`
      )
    } finally {
      // Always remove this block from active blocks when execution completes or fails
      const finalActiveBlocks = useExecutionStore.getState().activeBlockIds
      const updatedActiveBlocks = new Set(finalActiveBlocks)
      updatedActiveBlocks.delete(block.id)
      logger.info(
        `Removing workflow block ${block.id} from active blocks. Active blocks before removal:`,
        Array.from(finalActiveBlocks)
      )
      setActiveBlocks(updatedActiveBlocks)
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
  private mapChildOutputToParent(childResult: any, childWorkflowName: string): BlockOutput {
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

    // Check if result is wrapped in response.data structure and unwrap it
    if (result?.response?.data) {
      result = result.response.data
    }

    // Return the child workflow's result directly without wrapper
    return result as Record<string, any>
  }
}
