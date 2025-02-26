import { useConsoleStore } from '@/stores/console/store'
import { useExecutionStore } from '@/stores/execution/store'
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

/**
 * Core execution engine that runs workflow blocks in topological order.
 *
 * Key design principles:
 * 1. Clear separation between orchestration and execution logic
 * 2. Immutable operation with explicit state management
 * 3. Robust handling of edge cases and production scenarios
 * 4. Clear logging and error tracking
 */
export class Executor {
  // Core components are initialized once and remain immutable
  private resolver: InputResolver
  private loopManager: LoopManager
  private pathTracker: PathTracker
  private blockHandlers: BlockHandler[]

  constructor(
    private workflow: SerializedWorkflow,
    private initialBlockStates: Record<string, BlockOutput> = {},
    private environmentVariables: Record<string, string> = {}
  ) {
    // Validate workflow structure
    this.validateWorkflow()

    // Initialize core components
    this.resolver = new InputResolver(workflow, environmentVariables)
    this.loopManager = new LoopManager(workflow.loops || {})
    this.pathTracker = new PathTracker(workflow)

    // Register block handlers in priority order
    this.blockHandlers = [
      // Special block types first
      new AgentBlockHandler(),
      new RouterBlockHandler(this.pathTracker),
      new ConditionBlockHandler(this.pathTracker),
      new EvaluatorBlockHandler(),

      // Tool-based blocks
      new FunctionBlockHandler(),
      new ApiBlockHandler(),

      // Generic handler as fallback
      new GenericBlockHandler(),
    ]
  }

  /**
   * Execute the workflow with comprehensive error handling and state tracking.
   */
  async execute(workflowId: string): Promise<ExecutionResult> {
    const { setIsExecuting, reset } = useExecutionStore.getState()
    const startTime = new Date()
    let finalOutput: NormalizedBlockOutput = { response: {} }

    // Create execution context with initial state
    const context = this.createExecutionContext(workflowId, startTime)

    try {
      setIsExecuting(true)

      // Execute workflow by layers until no more blocks can be executed
      let hasMoreLayers = true
      let iteration = 0
      const maxIterations = 100 // Safety limit to prevent infinite loops

      while (hasMoreLayers && iteration < maxIterations) {
        const nextLayer = this.getNextExecutionLayer(context)

        if (nextLayer.length === 0) {
          hasMoreLayers = false
        } else {
          // Execute all blocks in the current layer
          const outputs = await this.executeLayer(nextLayer, context)

          // Get the final output from the last layer
          if (outputs.length > 0) {
            finalOutput = outputs[outputs.length - 1]
          }

          // Process any loop iterations
          const hasLoopReachedMaxIterations = await this.loopManager.processLoopIterations(context)

          // If any loop has reached its maximum iterations, add a log entry and terminate
          if (hasLoopReachedMaxIterations) {
            hasMoreLayers = false
          }
        }

        iteration++
      }

      // Record completion time
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
      console.error('Workflow execution failed:', error)

      return {
        success: false,
        output: finalOutput,
        error: error.message || 'Workflow execution failed',
        logs: context.blockLogs,
      }
    } finally {
      reset() // Reset execution state
    }
  }

  /**
   * Validate that the workflow meets requirements for execution
   */
  private validateWorkflow(): void {
    // Starter block validation
    const starterBlock = this.workflow.blocks.find((block) => block.metadata?.id === 'starter')
    if (!starterBlock || !starterBlock.enabled) {
      throw new Error('Workflow must have an enabled starter block')
    }

    // Validate that starter block is properly connected
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

    // Validate block references
    const blockIds = new Set(this.workflow.blocks.map((block) => block.id))
    for (const conn of this.workflow.connections) {
      if (!blockIds.has(conn.source)) {
        throw new Error(`Connection references non-existent source block: ${conn.source}`)
      }
      if (!blockIds.has(conn.target)) {
        throw new Error(`Connection references non-existent target block: ${conn.target}`)
      }
    }

    // Validate loops
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
   * Create the initial execution context with predefined states
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

    // Pre-populate with initial states
    Object.entries(this.initialBlockStates).forEach(([blockId, output]) => {
      context.blockStates.set(blockId, {
        output: output as NormalizedBlockOutput,
        executed: true,
        executionTime: 0,
      })
    })

    // Add starter block state
    const starterBlock = this.workflow.blocks.find((block) => block.metadata?.id === 'starter')
    if (starterBlock) {
      context.blockStates.set(starterBlock.id, {
        output: { response: { result: true } },
        executed: true,
        executionTime: 0,
      })
      context.executedBlocks.add(starterBlock.id)

      // Add blocks connected to starter to active execution path
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
   * Determine the next layer of blocks to execute based on dependencies and execution path
   */
  private getNextExecutionLayer(context: ExecutionContext): string[] {
    const executedBlocks = context.executedBlocks
    const pendingBlocks = new Set<string>()

    // Find all blocks that could potentially be executed
    for (const block of this.workflow.blocks) {
      // Skip already executed blocks and disabled blocks
      if (executedBlocks.has(block.id) || block.enabled === false) {
        continue
      }

      // Skip blocks not in the active execution path
      if (!context.activeExecutionPath.has(block.id)) {
        continue
      }

      // Get incoming connections
      const incomingConnections = this.workflow.connections.filter(
        (conn) => conn.target === block.id
      )

      // IMPORTANT FIX: For blocks in a loop, we don't require all connections to be executed
      // We only need one valid path to the block
      const isInLoop = Object.values(this.workflow.loops || {}).some((loop) =>
        loop.nodes.includes(block.id)
      )

      if (isInLoop) {
        // For blocks in a loop, at least one incoming connection should be from an executed block
        // (typically the entry point to the loop)
        const hasValidPath = incomingConnections.some((conn) => {
          // Only consider connections from executed blocks
          return executedBlocks.has(conn.source)
        })

        if (hasValidPath) {
          pendingBlocks.add(block.id)
        }
      } else {
        // For regular blocks (not in a loop), require all dependencies to be met
        const allDependenciesMet = incomingConnections.every((conn) => {
          // Check if source block is executed
          const sourceExecuted = executedBlocks.has(conn.source)

          // For condition blocks, check if this is the selected path
          if (conn.sourceHandle?.startsWith('condition-')) {
            const sourceBlock = this.workflow.blocks.find((b) => b.id === conn.source)
            if (sourceBlock?.metadata?.id === 'condition') {
              const conditionId = conn.sourceHandle.replace('condition-', '')
              const selectedCondition = context.decisions.condition.get(conn.source)

              // If the condition block has made a decision and this isn't the selected path,
              // we don't need to wait for this dependency
              if (sourceExecuted && selectedCondition && conditionId !== selectedCondition) {
                return true // Skip this dependency check
              }

              return sourceExecuted && conditionId === selectedCondition
            }
          }

          // For router blocks, check if this is the selected path
          const sourceBlock = this.workflow.blocks.find((b) => b.id === conn.source)
          if (sourceBlock?.metadata?.id === 'router') {
            const selectedTarget = context.decisions.router.get(conn.source)

            // If the router has made a decision and this isn't the selected target,
            // we don't need to wait for this dependency
            if (sourceExecuted && selectedTarget && conn.target !== selectedTarget) {
              return true // Skip this dependency check
            }

            return sourceExecuted && conn.target === selectedTarget
          }

          // Check if the source block is in an inactive path
          const isSourceInActivePath = context.activeExecutionPath.has(conn.source)

          // If source is not in active path, don't require it to be executed
          if (!isSourceInActivePath) {
            return true // Skip this dependency check
          }

          return sourceExecuted
        })

        if (allDependenciesMet) {
          pendingBlocks.add(block.id)
        }
      }
    }

    // Convert to array and return
    return Array.from(pendingBlocks)
  }

  /**
   * Execute a layer of blocks in parallel
   */
  private async executeLayer(
    blockIds: string[],
    context: ExecutionContext
  ): Promise<NormalizedBlockOutput[]> {
    const { setActiveBlocks } = useExecutionStore.getState()

    try {
      // Set all blocks in the layer as active
      setActiveBlocks(new Set(blockIds))

      // Execute all blocks in parallel
      const results = await Promise.all(
        blockIds.map((blockId) => this.executeBlock(blockId, context))
      )

      // Mark blocks as executed
      blockIds.forEach((blockId) => {
        context.executedBlocks.add(blockId)
      })

      // Update execution paths based on router and condition decisions
      this.pathTracker.updateExecutionPaths(blockIds, context)

      return results
    } finally {
      // Clear active blocks
      setActiveBlocks(new Set())
    }
  }

  /**
   * Execute a single block with full error handling and logging
   */
  private async executeBlock(
    blockId: string,
    context: ExecutionContext
  ): Promise<NormalizedBlockOutput> {
    const block = this.workflow.blocks.find((b) => b.id === blockId)
    if (!block) {
      throw new Error(`Block ${blockId} not found`)
    }

    // Create block log
    const blockLog = this.createBlockLog(block)
    const addConsole = useConsoleStore.getState().addConsole

    try {
      // Check if block is enabled
      if (block.enabled === false) {
        throw new Error(`Cannot execute disabled block: ${block.metadata?.name || block.id}`)
      }

      // Resolve inputs
      const inputs = this.resolver.resolveInputs(block, context)

      // Find a handler for this block type
      const handler = this.blockHandlers.find((h) => h.canHandle(block))
      if (!handler) {
        throw new Error(`No handler found for block type: ${block.metadata?.id}`)
      }

      // Execute the block
      const startTime = performance.now()
      const rawOutput = await handler.execute(block, inputs, context)
      const executionTime = performance.now() - startTime

      // Normalize the output to ensure it has the expected structure
      const output = this.normalizeBlockOutput(rawOutput, block)

      // Update block state
      context.blockStates.set(blockId, {
        output,
        executed: true,
        executionTime,
      })

      // Finalize log
      blockLog.success = true
      blockLog.output = output
      blockLog.durationMs = Math.round(executionTime)
      blockLog.endedAt = new Date().toISOString()

      // Add to logs and console
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
      // Log error
      blockLog.success = false
      blockLog.error = error.message
      blockLog.endedAt = new Date().toISOString()
      blockLog.durationMs =
        new Date(blockLog.endedAt).getTime() - new Date(blockLog.startedAt).getTime()

      // Add to logs and console
      context.blockLogs.push(blockLog)
      addConsole({
        output: {},
        error: error.message,
        durationMs: blockLog.durationMs,
        startedAt: blockLog.startedAt,
        endedAt: blockLog.endedAt,
        workflowId: context.workflowId,
        timestamp: blockLog.startedAt,
        blockName: block.metadata?.name || 'Unnamed Block',
        blockType: block.metadata?.id || 'unknown',
      })

      throw error
    }
  }

  /**
   * Normalize a block output to ensure it has the expected structure
   */
  private normalizeBlockOutput(output: any, block: SerializedBlock): NormalizedBlockOutput {
    // If output already has a response property, use it
    if (output && typeof output === 'object' && 'response' in output) {
      return output as NormalizedBlockOutput
    }

    // If output is primitive or doesn't have a response property, wrap it
    const blockType = block.metadata?.id

    if (blockType === 'agent') {
      return {
        response: {
          content: output?.content || '',
          model: output?.model || '',
          tokens: output?.tokens || { prompt: 0, completion: 0, total: 0 },
          toolCalls: output?.toolCalls || { list: [], count: 0 },
        },
      }
    }

    if (blockType === 'router') {
      return {
        response: {
          content: '',
          model: '',
          tokens: { prompt: 0, completion: 0, total: 0 },
          selectedPath: output?.selectedPath || { blockId: '', blockType: '', blockTitle: '' },
        },
      }
    }

    if (blockType === 'condition') {
      return {
        response: {
          conditionResult: output?.conditionResult || false,
          selectedPath: output?.selectedPath || { blockId: '', blockType: '', blockTitle: '' },
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
      // Create response object with an index signature to allow any string key
      const evaluatorResponse: {
        content: string
        model: string
        [key: string]: any
      } = {
        content: output?.content || '',
        model: output?.model || '',
      }

      // Copy all metrics from the original output
      if (output && typeof output === 'object') {
        Object.keys(output).forEach((key) => {
          if (key !== 'content' && key !== 'model') {
            evaluatorResponse[key] = output[key]
          }
        })
      }

      return { response: evaluatorResponse }
    }

    // Default fallback
    return {
      response: { result: output },
    }
  }

  /**
   * Create a new block log entry
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
}
