import { createLogger } from '@/lib/logs/console-logger'
import { useExecutionStore } from '@/stores/execution/store'
import { useConsoleStore } from '@/stores/panel/console/store'
import { useGeneralStore } from '@/stores/settings/general/store'
import { BlockOutput } from '@/blocks/types'
import { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import {
  AgentBlockHandler,
  ApiBlockHandler,
  BlockHandler,
  ConditionBlockHandler,
  EvaluatorBlockHandler,
  FunctionBlockHandler,
  GenericBlockHandler,
  RouterBlockHandler,
} from './handlers'
import { LoopManager } from './loops'
import { PathTracker } from './path'
import { InputResolver } from './resolver'
import { BlockLog, ExecutionContext, ExecutionResult, NormalizedBlockOutput } from './types'

const logger = createLogger('Executor')

/**
 * Core execution engine that runs workflow blocks in topological order.
 *
 * Handles block execution, state management, and error handling.
 */
export class Executor {
  // Core components are initialized once and remain immutable
  private resolver: InputResolver
  private loopManager: LoopManager
  private pathTracker: PathTracker
  private blockHandlers: BlockHandler[]
  private workflowInput: any
  private isDebugging: boolean = false

  constructor(
    private workflow: SerializedWorkflow,
    private initialBlockStates: Record<string, BlockOutput> = {},
    private environmentVariables: Record<string, string> = {},
    private workflowVariables: Record<string, any> = {},
    workflowInput?: any
  ) {
    this.validateWorkflow()
    this.workflowInput = workflowInput || {}

    this.resolver = new InputResolver(workflow, environmentVariables, workflowVariables)
    this.loopManager = new LoopManager(workflow.loops || {})
    this.pathTracker = new PathTracker(workflow)

    this.blockHandlers = [
      new AgentBlockHandler(),
      new RouterBlockHandler(this.pathTracker),
      new ConditionBlockHandler(this.pathTracker),
      new EvaluatorBlockHandler(),
      new FunctionBlockHandler(),
      new ApiBlockHandler(),
      new GenericBlockHandler(),
    ]

    this.isDebugging = useGeneralStore.getState().isDebugModeEnabled
  }

  /**
   * Executes the workflow and returns the result.
   *
   * @param workflowId - Unique identifier for the workflow execution
   * @returns Execution result containing output, logs, and metadata
   */
  async execute(workflowId: string): Promise<ExecutionResult> {
    const { setIsExecuting, setIsDebugging, setPendingBlocks, reset } = useExecutionStore.getState()
    const startTime = new Date()
    let finalOutput: NormalizedBlockOutput = { response: {} }

    this.validateWorkflow()

    const context = this.createExecutionContext(workflowId, startTime)

    try {
      setIsExecuting(true)

      if (this.isDebugging) {
        setIsDebugging(true)
      }

      let hasMoreLayers = true
      let iteration = 0
      const maxIterations = 100 // Safety limit for infinite loops

      while (hasMoreLayers && iteration < maxIterations) {
        const nextLayer = this.getNextExecutionLayer(context)

        if (this.isDebugging) {
          // In debug mode, update the pending blocks and wait for user interaction
          setPendingBlocks(nextLayer)

          // If there are no more blocks, we're done
          if (nextLayer.length === 0) {
            hasMoreLayers = false
          } else {
            // Return early to wait for manual stepping
            // The caller (useWorkflowExecution) will handle resumption
            return {
              success: true,
              output: finalOutput,
              metadata: {
                duration: Date.now() - startTime.getTime(),
                startTime: context.metadata.startTime!,
                pendingBlocks: nextLayer,
                isDebugSession: true,
                context: context, // Include context for resumption
              },
              logs: context.blockLogs,
            }
          }
        } else {
          // Normal execution without debug mode
          if (nextLayer.length === 0) {
            hasMoreLayers = false
          } else {
            const outputs = await this.executeLayer(nextLayer, context)

            if (outputs.length > 0) {
              finalOutput = outputs[outputs.length - 1]
            }

            const hasLoopReachedMaxIterations =
              await this.loopManager.processLoopIterations(context)
            if (hasLoopReachedMaxIterations) {
              hasMoreLayers = false
            }
          }
        }

        iteration++
      }

      const endTime = new Date()
      context.metadata.endTime = endTime.toISOString()

      return {
        success: true,
        output: finalOutput,
        metadata: {
          duration: endTime.getTime() - startTime.getTime(),
          startTime: context.metadata.startTime!,
          endTime: context.metadata.endTime!,
        },
        logs: context.blockLogs,
      }
    } catch (error: any) {
      logger.error('Workflow execution failed:', this.sanitizeError(error))

      return {
        success: false,
        output: finalOutput,
        error: this.extractErrorMessage(error),
        logs: context.blockLogs,
      }
    } finally {
      if (!this.isDebugging) {
        reset()
      }
    }
  }

  /**
   * Continues execution in debug mode from the current state.
   *
   * @param blockIds - Block IDs to execute in this step
   * @param context - The current execution context
   * @returns Updated execution result
   */
  async continueExecution(blockIds: string[], context: ExecutionContext): Promise<ExecutionResult> {
    const { setPendingBlocks } = useExecutionStore.getState()
    let finalOutput: NormalizedBlockOutput = { response: {} }

    try {
      // Execute the current layer - using the original context, not a clone
      const outputs = await this.executeLayer(blockIds, context)

      if (outputs.length > 0) {
        finalOutput = outputs[outputs.length - 1]
      }

      await this.loopManager.processLoopIterations(context)
      const nextLayer = this.getNextExecutionLayer(context)
      setPendingBlocks(nextLayer)

      // Check if we've completed execution
      const isComplete = nextLayer.length === 0

      if (isComplete) {
        const endTime = new Date()
        context.metadata.endTime = endTime.toISOString()

        return {
          success: true,
          output: finalOutput,
          metadata: {
            duration: endTime.getTime() - new Date(context.metadata.startTime!).getTime(),
            startTime: context.metadata.startTime!,
            endTime: context.metadata.endTime!,
            pendingBlocks: [],
            isDebugSession: false,
          },
          logs: context.blockLogs,
        }
      }

      // Return the updated state for the next step
      return {
        success: true,
        output: finalOutput,
        metadata: {
          duration: Date.now() - new Date(context.metadata.startTime!).getTime(),
          startTime: context.metadata.startTime!,
          pendingBlocks: nextLayer,
          isDebugSession: true,
          context: context, // Return the same context object for continuity
        },
        logs: context.blockLogs,
      }
    } catch (error: any) {
      console.error('Debug step execution failed:', this.sanitizeError(error))

      return {
        success: false,
        output: finalOutput,
        error: this.extractErrorMessage(error),
        logs: context.blockLogs,
      }
    }
  }

  /**
   * Validates that the workflow meets requirements for execution.
   * Checks for starter block, connections, and loop configurations.
   *
   * @throws Error if workflow validation fails
   */
  private validateWorkflow(): void {
    const starterBlock = this.workflow.blocks.find((block) => block.metadata?.id === 'starter')
    if (!starterBlock || !starterBlock.enabled) {
      throw new Error('Workflow must have an enabled starter block')
    }

    const incomingToStarter = this.workflow.connections.filter(
      (conn) => conn.target === starterBlock.id
    )
    if (incomingToStarter.length > 0) {
      throw new Error('Starter block cannot have incoming connections')
    }

    const outgoingFromStarter = this.workflow.connections.filter(
      (conn) => conn.source === starterBlock.id
    )
    if (outgoingFromStarter.length === 0) {
      throw new Error('Starter block must have at least one outgoing connection')
    }

    const blockIds = new Set(this.workflow.blocks.map((block) => block.id))
    for (const conn of this.workflow.connections) {
      if (!blockIds.has(conn.source)) {
        throw new Error(`Connection references non-existent source block: ${conn.source}`)
      }
      if (!blockIds.has(conn.target)) {
        throw new Error(`Connection references non-existent target block: ${conn.target}`)
      }
    }

    for (const [loopId, loop] of Object.entries(this.workflow.loops || {})) {
      for (const nodeId of loop.nodes) {
        if (!blockIds.has(nodeId)) {
          throw new Error(`Loop ${loopId} references non-existent block: ${nodeId}`)
        }
      }

      if (loop.nodes.length < 2) {
        throw new Error(`Loop ${loopId} must contain at least 2 blocks`)
      }

      if (loop.maxIterations <= 0) {
        throw new Error(`Loop ${loopId} must have a positive maxIterations value`)
      }
    }
  }

  /**
   * Creates the initial execution context with predefined states.
   * Sets up the starter block and its connections in the active execution path.
   *
   * @param workflowId - Unique identifier for the workflow execution
   * @param startTime - Execution start time
   * @returns Initialized execution context
   */
  private createExecutionContext(workflowId: string, startTime: Date): ExecutionContext {
    const context: ExecutionContext = {
      workflowId,
      blockStates: new Map(),
      blockLogs: [],
      metadata: {
        startTime: startTime.toISOString(),
      },
      environmentVariables: this.environmentVariables,
      decisions: {
        router: new Map(),
        condition: new Map(),
      },
      loopIterations: new Map(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      workflow: this.workflow,
    }

    Object.entries(this.initialBlockStates).forEach(([blockId, output]) => {
      context.blockStates.set(blockId, {
        output: output as NormalizedBlockOutput,
        executed: true,
        executionTime: 0,
      })
    })

    const starterBlock = this.workflow.blocks.find((block) => block.metadata?.id === 'starter')
    if (starterBlock) {
      // Initialize the starter block with the workflow input
      const starterOutput = {
        response: {
          input: this.workflowInput,
        },
      }

      context.blockStates.set(starterBlock.id, {
        output: starterOutput,
        executed: true,
        executionTime: 0,
      })

      // Mark the starter block as executed and add its connections to the active path
      context.executedBlocks.add(starterBlock.id)

      const connectedToStarter = this.workflow.connections
        .filter((conn) => conn.source === starterBlock.id)
        .map((conn) => conn.target)

      connectedToStarter.forEach((blockId) => {
        context.activeExecutionPath.add(blockId)
      })
    }

    return context
  }

  /**
   * Determines the next layer of blocks to execute based on dependencies and execution path.
   * Handles special cases for blocks in loops, condition blocks, and router blocks.
   *
   * @param context - Current execution context
   * @returns Array of block IDs that are ready to be executed
   */
  private getNextExecutionLayer(context: ExecutionContext): string[] {
    const executedBlocks = context.executedBlocks
    const pendingBlocks = new Set<string>()

    for (const block of this.workflow.blocks) {
      if (executedBlocks.has(block.id) || block.enabled === false) {
        continue
      }

      // Only consider blocks in the active execution path
      if (!context.activeExecutionPath.has(block.id)) {
        continue
      }

      const incomingConnections = this.workflow.connections.filter(
        (conn) => conn.target === block.id
      )

      const isInLoop = Object.values(this.workflow.loops || {}).some((loop) =>
        loop.nodes.includes(block.id)
      )

      if (isInLoop) {
        const hasValidPath = incomingConnections.some((conn) => {
          return executedBlocks.has(conn.source)
        })

        if (hasValidPath) {
          pendingBlocks.add(block.id)
        }
      } else {
        const allDependenciesMet = incomingConnections.every((conn) => {
          const sourceExecuted = executedBlocks.has(conn.source)
          const sourceBlock = this.workflow.blocks.find((b) => b.id === conn.source)
          const sourceBlockState = context.blockStates.get(conn.source)
          const hasSourceError =
            sourceBlockState?.output?.error !== undefined ||
            sourceBlockState?.output?.response?.error !== undefined

          // For condition blocks, check if this is the selected path
          if (conn.sourceHandle?.startsWith('condition-')) {
            const sourceBlock = this.workflow.blocks.find((b) => b.id === conn.source)
            if (sourceBlock?.metadata?.id === 'condition') {
              const conditionId = conn.sourceHandle.replace('condition-', '')
              const selectedCondition = context.decisions.condition.get(conn.source)

              // If source is executed and this is not the selected path, consider it met
              if (sourceExecuted && selectedCondition && conditionId !== selectedCondition) {
                return true
              }

              // Otherwise, this dependency is met only if source is executed and this is the selected path
              return sourceExecuted && conditionId === selectedCondition
            }
          }

          // For router blocks, check if this is the selected target
          if (sourceBlock?.metadata?.id === 'router') {
            const selectedTarget = context.decisions.router.get(conn.source)

            // If source is executed and this is not the selected target, consider it met
            if (sourceExecuted && selectedTarget && conn.target !== selectedTarget) {
              return true
            }

            // Otherwise, this dependency is met only if source is executed and this is the selected target
            return sourceExecuted && conn.target === selectedTarget
          }

          // For error connections, check if the source had an error
          if (conn.sourceHandle === 'error') {
            return sourceExecuted && hasSourceError
          }

          // For regular connections, check if the source was executed without error
          if (conn.sourceHandle === 'source' || !conn.sourceHandle) {
            return sourceExecuted && !hasSourceError
          }

          // If source is not in active path, consider this dependency met
          // This allows blocks with multiple inputs to execute even if some inputs are from inactive paths
          if (!context.activeExecutionPath.has(conn.source)) {
            return true
          }

          // For regular blocks, dependency is met if source is executed
          return sourceExecuted
        })

        if (allDependenciesMet) {
          pendingBlocks.add(block.id)
        }
      }
    }

    return Array.from(pendingBlocks)
  }

  /**
   * Executes a layer of blocks in parallel.
   * Updates execution paths based on router and condition decisions.
   *
   * @param blockIds - IDs of blocks to execute
   * @param context - Current execution context
   * @returns Array of block outputs
   */
  private async executeLayer(
    blockIds: string[],
    context: ExecutionContext
  ): Promise<NormalizedBlockOutput[]> {
    const { setActiveBlocks } = useExecutionStore.getState()

    try {
      setActiveBlocks(new Set(blockIds))

      const results = await Promise.all(
        blockIds.map((blockId) => this.executeBlock(blockId, context))
      )

      blockIds.forEach((blockId) => {
        context.executedBlocks.add(blockId)
      })

      this.pathTracker.updateExecutionPaths(blockIds, context)

      return results
    } finally {
      setActiveBlocks(new Set())
    }
  }

  /**
   * Executes a single block with error handling and logging.
   *
   * @param blockId - ID of the block to execute
   * @param context - Current execution context
   * @returns Normalized block output
   * @throws Error if block execution fails
   */
  private async executeBlock(
    blockId: string,
    context: ExecutionContext
  ): Promise<NormalizedBlockOutput> {
    const block = this.workflow.blocks.find((b) => b.id === blockId)
    if (!block) {
      throw new Error(`Block ${blockId} not found`)
    }

    // Special case for starter block - it's already been initialized in createExecutionContext
    // This ensures we don't re-execute the starter block and just return its existing state
    if (block.metadata?.id === 'starter') {
      const starterState = context.blockStates.get(blockId)
      if (starterState) {
        return starterState.output as NormalizedBlockOutput
      }
    }

    const blockLog = this.createBlockLog(block)
    const addConsole = useConsoleStore.getState().addConsole

    try {
      if (block.enabled === false) {
        throw new Error(`Cannot execute disabled block: ${block.metadata?.name || block.id}`)
      }

      const inputs = this.resolver.resolveInputs(block, context)

      const handler = this.blockHandlers.find((h) => h.canHandle(block))
      if (!handler) {
        throw new Error(`No handler found for block type: ${block.metadata?.id}`)
      }

      const startTime = performance.now()
      const rawOutput = await handler.execute(block, inputs, context)
      const executionTime = performance.now() - startTime

      const output = this.normalizeBlockOutput(rawOutput, block)

      context.blockStates.set(blockId, {
        output,
        executed: true,
        executionTime,
      })

      blockLog.success = true
      blockLog.output = output
      blockLog.durationMs = Math.round(executionTime)
      blockLog.endedAt = new Date().toISOString()

      context.blockLogs.push(blockLog)
      addConsole({
        output: blockLog.output,
        durationMs: blockLog.durationMs,
        startedAt: blockLog.startedAt,
        endedAt: blockLog.endedAt,
        workflowId: context.workflowId,
        timestamp: blockLog.startedAt,
        blockName: block.metadata?.name || 'Unnamed Block',
        blockType: block.metadata?.id || 'unknown',
      })

      return output
    } catch (error: any) {
      blockLog.success = false
      blockLog.error =
        error.message ||
        `Error executing ${block.metadata?.id || 'unknown'} block: ${String(error)}`
      blockLog.endedAt = new Date().toISOString()
      blockLog.durationMs =
        new Date(blockLog.endedAt).getTime() - new Date(blockLog.startedAt).getTime()

      // Log the error even if we'll continue execution through error path
      context.blockLogs.push(blockLog)
      addConsole({
        output: {},
        error:
          error.message ||
          `Error executing ${block.metadata?.id || 'unknown'} block: ${String(error)}`,
        durationMs: blockLog.durationMs,
        startedAt: blockLog.startedAt,
        endedAt: blockLog.endedAt,
        workflowId: context.workflowId,
        timestamp: blockLog.startedAt,
        blockName: block.metadata?.name || 'Unnamed Block',
        blockType: block.metadata?.id || 'unknown',
      })

      // Create error output with appropriate structure
      const errorOutput: NormalizedBlockOutput = {
        response: {
          error: this.extractErrorMessage(error),
          status: error.status || 500,
        },
        error: this.extractErrorMessage(error),
      }

      // Set block state with error output
      context.blockStates.set(blockId, {
        output: errorOutput,
        executed: true,
        executionTime: blockLog.durationMs,
      })

      // Check for error connections and follow them if they exist
      const hasErrorPath = this.activateErrorPath(blockId, context)

      // Console.error the error for visibility
      logger.error(
        `Error executing block ${block.metadata?.name || blockId}:`,
        this.sanitizeError(error)
      )

      // If there are error paths to follow, return error output instead of throwing
      if (hasErrorPath) {
        // Return the error output to allow execution to continue along error path
        return errorOutput
      }

      // Create a proper error message that is never undefined
      let errorMessage = error.message

      // Handle the specific "undefined (undefined)" case
      if (!errorMessage || errorMessage === 'undefined (undefined)') {
        errorMessage = `Error executing ${block.metadata?.id || 'unknown'} block: ${block.metadata?.name || 'Unnamed Block'}`

        // Try to get more details if possible
        if (error && typeof error === 'object') {
          if (error.code) errorMessage += ` (code: ${error.code})`
          if (error.status) errorMessage += ` (status: ${error.status})`
          if (error.type) errorMessage += ` (type: ${error.type})`
        }
      }

      throw new Error(errorMessage)
    }
  }

  /**
   * Activates error paths from a block that had an error.
   * Checks for connections from the block's "error" handle and adds them to the active execution path.
   *
   * @param blockId - ID of the block that had an error
   * @param context - Current execution context
   * @returns Whether there was an error path to follow
   */
  private activateErrorPath(blockId: string, context: ExecutionContext): boolean {
    // Skip for starter blocks which don't have error handles
    const block = this.workflow.blocks.find((b) => b.id === blockId)
    if (block?.metadata?.id === 'starter' || block?.metadata?.id === 'condition') {
      return false
    }

    // Look for connections from this block's error handle
    const errorConnections = this.workflow.connections.filter(
      (conn) => conn.source === blockId && conn.sourceHandle === 'error'
    )

    if (errorConnections.length === 0) {
      return false
    }

    // Add all error connection targets to the active execution path
    for (const conn of errorConnections) {
      context.activeExecutionPath.add(conn.target)
      logger.info(`Activated error path from ${blockId} to ${conn.target}`)
    }

    return true
  }

  /**
   * Normalizes a block output to ensure it has the expected structure.
   * Handles different block types with appropriate response formats.
   *
   * @param output - Raw output from block execution
   * @param block - Block that produced the output
   * @returns Normalized output with consistent structure
   */
  private normalizeBlockOutput(output: any, block: SerializedBlock): NormalizedBlockOutput {
    // Handle error outputs
    if (output && typeof output === 'object' && output.error) {
      return {
        response: {
          error: output.error,
          status: output.status || 500,
        },
        error: output.error,
      }
    }

    if (output && typeof output === 'object' && 'response' in output) {
      // If response already contains an error, maintain it
      if (output.response && output.response.error) {
        return {
          ...output,
          error: output.response.error,
        }
      }
      return output as NormalizedBlockOutput
    }

    const blockType = block.metadata?.id

    if (blockType === 'agent') {
      return output
    }

    if (blockType === 'router') {
      return {
        response: {
          content: '',
          model: '',
          tokens: { prompt: 0, completion: 0, total: 0 },
          selectedPath: output?.selectedPath || {
            blockId: '',
            blockType: '',
            blockTitle: '',
          },
        },
      }
    }

    if (blockType === 'condition') {
      if (output && typeof output === 'object' && 'response' in output) {
        return {
          response: {
            ...output.response,
            conditionResult: output.response.conditionResult || false,
            selectedPath: output.response.selectedPath || {
              blockId: '',
              blockType: '',
              blockTitle: '',
            },
            selectedConditionId: output.response.selectedConditionId || '',
          },
        }
      }

      return {
        response: {
          conditionResult: output?.conditionResult || false,
          selectedPath: output?.selectedPath || {
            blockId: '',
            blockType: '',
            blockTitle: '',
          },
          selectedConditionId: output?.selectedConditionId || '',
        },
      }
    }

    if (blockType === 'function') {
      return {
        response: {
          result: output?.result,
          stdout: output?.stdout || '',
          executionTime: output?.executionTime || 0,
        },
      }
    }

    if (blockType === 'api') {
      return {
        response: {
          data: output?.data,
          status: output?.status || 0,
          headers: output?.headers || {},
        },
      }
    }

    if (blockType === 'evaluator') {
      const evaluatorResponse: {
        content: string
        model: string
        [key: string]: any
      } = {
        content: output?.content || '',
        model: output?.model || '',
      }

      if (output && typeof output === 'object') {
        Object.keys(output).forEach((key) => {
          if (key !== 'content' && key !== 'model') {
            evaluatorResponse[key] = output[key]
          }
        })
      }

      return { response: evaluatorResponse }
    }

    return {
      response: { result: output },
    }
  }

  /**
   * Creates a new block log entry with initial values.
   *
   * @param block - Block to create log for
   * @returns Initialized block log
   */
  private createBlockLog(block: SerializedBlock): BlockLog {
    return {
      blockId: block.id,
      blockName: block.metadata?.name || '',
      blockType: block.metadata?.id || '',
      startedAt: new Date().toISOString(),
      endedAt: '',
      durationMs: 0,
      success: false,
    }
  }

  /**
   * Extracts a meaningful error message from any error object structure.
   * Handles nested error objects, undefined messages, and various error formats.
   *
   * @param error - The error object to extract a message from
   * @returns A meaningful error message string
   */
  private extractErrorMessage(error: any): string {
    if (!error) return 'Unknown error occurred'

    // Handle Error instances
    if (error instanceof Error) {
      return error.message || `Error: ${String(error)}`
    }

    // Handle string errors
    if (typeof error === 'string') {
      return error
    }

    // Handle object errors with nested structure
    if (typeof error === 'object') {
      // Case: { error: { message: "msg" } }
      if (error.error && typeof error.error === 'object' && error.error.message) {
        return error.error.message
      }

      // Case: { error: "msg" }
      if (error.error && typeof error.error === 'string') {
        return error.error
      }

      // Case: { message: "msg" }
      if (error.message) {
        return error.message
      }

      // Add specific handling for HTTP errors
      if (error.status || error.request) {
        let message = 'API request failed'

        // Add URL information if available
        if (error.request && error.request.url) {
          message += `: ${error.request.url}`
        }

        // Add status code if available
        if (error.status) {
          message += ` (Status: ${error.status})`
        }

        return message
      }

      // Last resort: try to stringify the object
      try {
        return `Error details: ${JSON.stringify(error)}`
      } catch {
        return 'Error occurred but details could not be displayed'
      }
    }

    return 'Unknown error occurred'
  }

  /**
   * Sanitizes an error object for logging purposes.
   * Ensures the error is in a format that won't cause "undefined" to appear in logs.
   *
   * @param error - The error object to sanitize
   * @returns A sanitized version of the error for logging
   */
  private sanitizeError(error: any): any {
    if (!error) return { message: 'No error details available' }

    // Handle Error instances
    if (error instanceof Error) {
      return {
        message: error.message || 'Error without message',
        stack: error.stack,
      }
    }

    // Handle string errors
    if (typeof error === 'string') {
      return { message: error }
    }

    // Handle object errors with nested structure
    if (typeof error === 'object') {
      // If error has a nested error object with undefined message, fix it
      if (error.error && typeof error.error === 'object') {
        if (!error.error.message) {
          error.error.message = 'No specific error message provided'
        }
      }

      // If no message property exists at root level, add one
      if (!error.message) {
        if (error.error && typeof error.error === 'string') {
          error.message = error.error
        } else if (error.status) {
          error.message = `API request failed with status ${error.status}`
        } else {
          error.message = 'Error occurred during workflow execution'
        }
      }

      return error
    }

    return { message: `Unexpected error type: ${typeof error}` }
  }
}
