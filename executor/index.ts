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
 * Handles block execution, state management, and error handling.
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
    this.validateWorkflow()

    this.resolver = new InputResolver(workflow, environmentVariables)
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
  }

  /**
   * Executes the workflow and returns the result.
   *
   * @param workflowId - Unique identifier for the workflow execution
   * @returns Execution result containing output, logs, and metadata
   */
  async execute(workflowId: string): Promise<ExecutionResult> {
    const { setIsExecuting, reset } = useExecutionStore.getState()
    const startTime = new Date()
    let finalOutput: NormalizedBlockOutput = { response: {} }

    this.validateWorkflow()

    const context = this.createExecutionContext(workflowId, startTime)

    try {
      setIsExecuting(true)

      let hasMoreLayers = true
      let iteration = 0
      const maxIterations = 100 // Safety limit for infinite loops

      while (hasMoreLayers && iteration < maxIterations) {
        const nextLayer = this.getNextExecutionLayer(context)

        if (nextLayer.length === 0) {
          hasMoreLayers = false
        } else {
          const outputs = await this.executeLayer(nextLayer, context)

          if (outputs.length > 0) {
            finalOutput = outputs[outputs.length - 1]
          }

          const hasLoopReachedMaxIterations = await this.loopManager.processLoopIterations(context)
          if (hasLoopReachedMaxIterations) {
            hasMoreLayers = false
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
      console.error('Workflow execution failed:', error)

      return {
        success: false,
        output: finalOutput,
        error: error.message || 'Workflow execution failed',
        logs: context.blockLogs,
      }
    } finally {
      reset()
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
      context.blockStates.set(starterBlock.id, {
        output: { response: { result: true } },
        executed: true,
        executionTime: 0,
      })
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
          const sourceBlock = this.workflow.blocks.find((b) => b.id === conn.source)
          if (sourceBlock?.metadata?.id === 'router') {
            const selectedTarget = context.decisions.router.get(conn.source)

            // If source is executed and this is not the selected target, consider it met
            if (sourceExecuted && selectedTarget && conn.target !== selectedTarget) {
              return true
            }

            // Otherwise, this dependency is met only if source is executed and this is the selected target
            return sourceExecuted && conn.target === selectedTarget
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
      blockLog.error = error.message
      blockLog.endedAt = new Date().toISOString()
      blockLog.durationMs =
        new Date(blockLog.endedAt).getTime() - new Date(blockLog.startedAt).getTime()

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
   * Normalizes a block output to ensure it has the expected structure.
   * Handles different block types with appropriate response formats.
   *
   * @param output - Raw output from block execution
   * @param block - Block that produced the output
   * @returns Normalized output with consistent structure
   */
  private normalizeBlockOutput(output: any, block: SerializedBlock): NormalizedBlockOutput {
    if (output && typeof output === 'object' && 'response' in output) {
      return output as NormalizedBlockOutput
    }

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
}
