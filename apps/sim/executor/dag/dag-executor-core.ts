/**
 * DAG Executor - Queue-based topological execution
 */

import { createLogger } from '@/lib/logs/console/logger'
import { BlockPathCalculator } from '@/lib/block-path-calculator'
import { getBlock } from '@/blocks'
import type { BlockOutput } from '@/blocks/types'
import { BlockType } from '@/executor/consts'
import {
  AgentBlockHandler,
  ApiBlockHandler,
  ConditionBlockHandler,
  EvaluatorBlockHandler,
  FunctionBlockHandler,
  GenericBlockHandler,
  ResponseBlockHandler,
  RouterBlockHandler,
  TriggerBlockHandler,
  VariablesBlockHandler,
  WaitBlockHandler,
  WorkflowBlockHandler,
} from '@/executor/handlers'
import { DAGResolver } from './dag-resolver'
import type {
  BlockHandler,
  BlockLog,
  ExecutionContext,
  ExecutionResult,
  NormalizedBlockOutput,
  StreamingExecution,
} from '@/executor/types'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'
import { useExecutionStore } from '@/stores/execution/store'
import { useConsoleStore } from '@/stores/panel/console/store'
import { DAGBuilder, type DAG, type DAGNode } from './dag-builder'

const logger = createLogger('DAGExecutor')

interface LoopScope {
  iteration: number
  maxIterations?: number
  item?: any
  items?: any[]
  currentIterationOutputs: Map<string, NormalizedBlockOutput>
  allIterationOutputs: NormalizedBlockOutput[]
}

/**
 * New DAG-based executor
 * - Queue-based continuous execution (no layers)
 * - Parallels expand to branches
 * - Loops use backwards-edges with iteration context
 */
export class DAGExecutor {
  private blockHandlers: BlockHandler[]
  private resolver: DAGResolver
  private workflow: SerializedWorkflow
  private workflowInput: any
  private environmentVariables: Record<string, string>
  private workflowVariables: Record<string, any>
  private contextExtensions: any
  private isCancelled = false
  private isChildExecution = false
  private initialBlockStates: Record<string, BlockOutput>

  constructor(options: {
    workflow: SerializedWorkflow
    currentBlockStates?: Record<string, BlockOutput>
    envVarValues?: Record<string, string>
    workflowInput?: any
    workflowVariables?: Record<string, any>
    contextExtensions?: any
  }) {
    this.workflow = options.workflow
    this.initialBlockStates = options.currentBlockStates || {}
    this.environmentVariables = options.envVarValues || {}
    this.workflowInput = options.workflowInput || {}
    this.workflowVariables = options.workflowVariables || {}
    this.contextExtensions = options.contextExtensions || {}
    this.isChildExecution = this.contextExtensions.isChildExecution || false

    // Initialize DAG-aware resolver
    this.resolver = new DAGResolver(
      this.workflow,
      this.environmentVariables,
      this.workflowVariables
    )

    // Initialize block handlers
    this.blockHandlers = [
      new TriggerBlockHandler(),
      new AgentBlockHandler(),
      new RouterBlockHandler(),
      new ConditionBlockHandler(),
      new EvaluatorBlockHandler(),
      new FunctionBlockHandler(),
      new ApiBlockHandler(),
      new ResponseBlockHandler(),
      new WorkflowBlockHandler(),
      new VariablesBlockHandler(),
      new WaitBlockHandler(),
      new GenericBlockHandler(),
    ]
  }

  /**
   * Execute workflow using DAG queue
   */
  async execute(workflowId: string, startBlockId?: string): Promise<ExecutionResult> {
    const startTime = new Date()
    const context = this.createExecutionContext(workflowId, startTime)

    // Build DAG (only reachable nodes from start)
    const dagBuilder = new DAGBuilder()
    const dag = dagBuilder.build(this.workflow, startBlockId)

    // Initialize ready queue
    const readyQueue: string[] = []

    if (startBlockId) {
      // Start from specific block
      readyQueue.push(startBlockId)
    } else {
      // Find all nodes with no incoming edges
      for (const [nodeId, node] of dag.nodes) {
        if (node.incomingEdges.size === 0) {
          readyQueue.push(nodeId)
        }
      }
    }

    logger.info('Starting DAG execution', {
      workflowId,
      totalNodes: dag.nodes.size,
      initialReadyBlocks: readyQueue.length,
    })

    let finalOutput: NormalizedBlockOutput = {}
    const loopScopes = new Map<string, LoopScope>()
    
    // Mutex for queue operations
    let queueLock = Promise.resolve()
    const withQueueLock = async <T>(fn: () => Promise<T>): Promise<T> => {
      const release = queueLock
      let releaseFn: () => void
      queueLock = new Promise(resolve => { releaseFn = resolve })
      await release
      try {
        return await fn()
      } finally {
        releaseFn!()
      }
    }

    try {
      // CONTINUOUS QUEUE PROCESSING WITH TRUE PARALLELISM
      // Launch all ready blocks concurrently and process edges as each completes
      const executing = new Set<Promise<void>>()
      
      while ((readyQueue.length > 0 || executing.size > 0) && !this.isCancelled) {
        // Launch all currently ready nodes (unless cancelled)
        while (readyQueue.length > 0 && !this.isCancelled) {
          const nodeId = readyQueue.shift()!
          const node = dag.nodes.get(nodeId)
          
          if (!node || context.executedBlocks.has(nodeId)) {
            continue
          }

          logger.debug('Launching node execution:', nodeId)
          
          // Launch execution (don't await - let it run in parallel)
          const execution = (async () => {
            try {
              // Execute the block
              const output = await this.executeBlock(node, context, loopScopes)
              finalOutput = output

              // Store output based on whether block is in a loop
              const baseId = this.extractBaseId(nodeId)
              const loopId = node.metadata.loopId
              
              if (loopId) {
                // Block is in a loop - store in iteration context
                const loopScope = loopScopes.get(loopId)
                if (loopScope) {
                  loopScope.currentIterationOutputs.set(baseId, output)
                }
              } else {
                // Regular block - store in global context
                context.blockStates.set(nodeId, {
                  output,
                  executed: true,
                  executionTime: 0,
                })
              }
              
              context.executedBlocks.add(nodeId)

              // Update DAG and queue with lock (prevent concurrent modifications)
              await withQueueLock(async () => {
                await this.processCompletedNode(node, output, dag, readyQueue, loopScopes, context)
              })
            } catch (error) {
              logger.error('Error executing node:', nodeId, error)
              throw error
            }
          })()
          
          executing.add(execution)
          execution.finally(() => executing.delete(execution))
        }

        // Wait for at least one to complete before checking queue again
        if (executing.size > 0) {
          await Promise.race(executing)
        }
      }

      // Wait for any remaining executing blocks to complete (don't abandon them)
      if (executing.size > 0) {
        logger.info('Waiting for executing blocks to complete before shutdown')
        await Promise.all(executing)
      }

      // Handle cancellation
      if (this.isCancelled) {
        const endTime = new Date()
        return {
          success: false,
          output: finalOutput,
          error: 'Workflow execution was cancelled',
          metadata: {
            duration: endTime.getTime() - startTime.getTime(),
            startTime: startTime.toISOString(),
            endTime: endTime.toISOString(),
          },
          logs: context.blockLogs,
        }
      }

      const endTime = new Date()
      return {
        success: true,
        output: finalOutput,
        metadata: {
          duration: endTime.getTime() - startTime.getTime(),
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
        },
        logs: context.blockLogs,
      }
    } catch (error: any) {
      logger.error('DAG execution failed:', error)

      return {
        success: false,
        output: finalOutput,
        error: error.message || 'Execution failed',
        metadata: {
          duration: Date.now() - startTime.getTime(),
          startTime: startTime.toISOString(),
        },
        logs: context.blockLogs,
      }
    }
  }

  /**
   * Process a completed node - update DAG and add ready nodes to queue
   */
  private async processCompletedNode(
    node: DAGNode,
    output: NormalizedBlockOutput,
    dag: DAG,
    readyQueue: string[],
    loopScopes: Map<string, LoopScope>,
    context: ExecutionContext
  ) {
    // Check if this is the last node in a loop - handle loop logic first
    if (node.metadata.isLoopNode) {
      const loopId = node.metadata.loopId
      const loopConfig = dag.loopConfigs.get(loopId!) as any
      const nodes = loopConfig?.nodes || []
      const isLastNodeInLoop = node.block.id === nodes[nodes.length - 1]

      if (isLastNodeInLoop) {
        // This is the last node in loop - decide: continue loop OR exit loop
        const shouldContinue = await this.handleLoopDecision(
          node,
          dag,
          readyQueue,
          loopScopes,
          context
        )

        if (shouldContinue) {
          // Loop continues - backwards-edge activated, DON'T process exit edges
          logger.debug('Loop continuing, skipping exit edge processing')
          return
        }
        logger.info('Loop exiting, processing exit edges')
        // Loop exits - fall through to process regular edges (exit edges)
      }
    }

    // Process regular outgoing edges
    logger.debug('Processing outgoing edges for node:', {
      nodeId: node.id,
      outgoingEdgeCount: node.outgoingEdges.size,
    })

    for (const [edgeId, edge] of node.outgoingEdges) {
      logger.debug('Processing edge:', { edgeId, target: edge.target, sourceHandle: edge.sourceHandle })

      // Skip backwards-edges (handled above)
      if (edge.sourceHandle === 'loop_continue') {
        logger.debug('Skipping backwards-edge')
        continue
      }

      // Check if edge should activate (handle conditionals)
      const shouldActivate = this.shouldActivateEdge(edge, output, node)

      if (!shouldActivate) {
        logger.debug('Edge not activated (conditional check failed)')
        continue
      }

      const targetNode = dag.nodes.get(edge.target)
      if (!targetNode) {
        logger.warn('Target node not found:', edge.target)
        continue
      }

      // Remove incoming edge from target
      targetNode.incomingEdges.delete(node.id)

      logger.debug('Removed incoming edge, target now has:', {
        target: edge.target,
        remainingIncomingEdges: targetNode.incomingEdges.size,
        remainingEdgesFrom: Array.from(targetNode.incomingEdges),
      })

      // If target has no more incoming edges, add to queue
      if (targetNode.incomingEdges.size === 0) {
        logger.debug('Node ready:', edge.target)
        readyQueue.push(edge.target)
      }
    }
  }

  /**
   * Check if an edge should activate based on conditionals
   */
  private shouldActivateEdge(
    edge: { target: string; sourceHandle?: string },
    output: NormalizedBlockOutput,
    sourceNode: DAGNode
  ): boolean {
    // Error edges only activate on error
    if (edge.sourceHandle === 'error') {
      return !!output.error
    }

    // Success edges don't activate on error
    if (edge.sourceHandle === 'source' || !edge.sourceHandle) {
      return !output.error
    }

    // Condition edges - check which condition was selected
    if (edge.sourceHandle?.startsWith('condition-')) {
      const selectedCondition = output.selectedConditionId
      const conditionId = edge.sourceHandle.replace('condition-', '')
      return conditionId === selectedCondition
    }

    // Default: activate
    return true
  }

  /**
   * Handle loop decision - returns true if loop continues, false if exits
   */
  private async handleLoopDecision(
    node: DAGNode,
    dag: DAG,
    readyQueue: string[],
    loopScopes: Map<string, LoopScope>,
    context: ExecutionContext
  ): Promise<boolean> {
    const loopId = node.metadata.loopId
    if (!loopId) return false

    const loopConfig = dag.loopConfigs.get(loopId) as any
    if (!loopConfig) return false

    const nodes = loopConfig.nodes || []
    const lastNodeId = nodes[nodes.length - 1]

    // Check if we should iterate again
    let scope = loopScopes.get(loopId)
    if (!scope) {
      // Initialize loop scope on first iteration
      scope = {
        iteration: 0,
        currentIterationOutputs: new Map(),
        allIterationOutputs: [],
      }
      loopScopes.set(loopId, scope)
    }

    // Store this iteration's output (from loop iteration context)
    const iterationOutput = scope.currentIterationOutputs.get(lastNodeId)
    if (iterationOutput) {
      scope.allIterationOutputs.push(iterationOutput)
    }

    // Check if we should continue BEFORE incrementing
    const shouldContinue = await this.evaluateLoopContinue(loopConfig, scope, context)

    logger.debug('Loop evaluation:', {
      loopId,
      currentIteration: scope.iteration,
      shouldContinue,
      loopType: loopConfig.loopType,
      maxIterations: loopConfig.iterations,
    })

    if (shouldContinue) {
      // Clear iteration outputs for next iteration
      scope.currentIterationOutputs.clear()
      scope.iteration++
      
      // Clear executed flags for all loop nodes (allow re-execution)
      for (const loopNodeId of nodes) {
        context.executedBlocks.delete(loopNodeId)
      }
      
      // Re-add first node to queue (backwards-edge!)
      const firstNodeId = nodes[0]
      logger.info('Loop continues to iteration', {
        loopId,
        iteration: scope.iteration,
        firstNode: firstNodeId,
      })
      readyQueue.push(firstNodeId)
      return true // Loop continues
    } else {
      // Loop exits - store aggregated results
      context.blockStates.set(`${loopId}.results`, {
        output: { results: scope.allIterationOutputs },
        executed: true,
        executionTime: 0,
      })
      logger.info('Loop completed:', { loopId, totalIterations: scope.iteration })
      return false // Loop exits, process exit edges
    }
  }

  /**
   * Evaluate if loop should continue iterating
   */
  private async evaluateLoopContinue(
    loopConfig: any,
    scope: LoopScope,
    context: ExecutionContext
  ): Promise<boolean> {
    const { loopType, iterations, forEachItems, whileCondition } = loopConfig

    switch (loopType) {
      case 'for':
        // Check if NEXT iteration (scope.iteration + 1) should run
        // Current iteration just completed, so check if there's another one
        return (scope.iteration + 1) < (iterations || 1)

      case 'forEach': {
        // Resolve items
        let items = forEachItems
        
        // If it's a string, try to parse it
        if (typeof items === 'string') {
          // Check if it's a reference like <blockName.output>
          if (items.startsWith('<') && items.endsWith('>')) {
            // TODO: Resolve the reference properly using DAGResolver
            logger.warn('ForEach items are a reference that needs resolution:', items)
            items = []
          } else {
            // It's a string literal array - parse it
            try {
              items = JSON.parse(items.replace(/'/g, '"')) // Replace single quotes with double quotes for JSON
            } catch (e) {
              logger.error('Failed to parse forEach items:', items, e)
              items = []
            }
          }
        }
        
        const itemsArray = Array.isArray(items)
          ? items
          : Object.entries(items || {})
          
        scope.items = itemsArray
        scope.maxIterations = itemsArray.length

        // Check if NEXT iteration exists
        const nextIteration = scope.iteration + 1
        if (nextIteration < itemsArray.length) {
          scope.item = itemsArray[nextIteration]
          return true
        }
        return false
      }

      case 'while':
      case 'doWhile': {
        // Evaluate while condition
        if (!whileCondition || whileCondition.trim() === '') {
          logger.warn(`${loopType} loop has no condition, defaulting to false (exit loop)`)
          return false
        }

        try {
          let evaluatedCondition = whileCondition
          
          // Resolve workflow variables using the exact same pattern as DAGResolver.resolveWorkflowVariable
          const variableMatches = evaluatedCondition.match(/<variable\.(\w+)>/g)
          if (variableMatches) {
            for (const match of variableMatches) {
              const variableName = match.slice(10, -1) // Extract name from <variable.name>
              
              // Use exact same resolution logic as DAGResolver
              let variable: any = null
              
              // First check context's workflow variables (these get updated by Variables blocks)
              if (context.workflowVariables) {
                for (const [varId, varObj] of Object.entries(context.workflowVariables)) {
                  const v = varObj as any
                  if (v.name === variableName || v.id === variableName) {
                    variable = v
                    break
                  }
                }
              }
              
              // Fallback to initial variables
              if (!variable && this.workflowVariables) {
                for (const [varId, varObj] of Object.entries(this.workflowVariables)) {
                  const v = varObj as any
                  if (v.name === variableName || v.id === variableName) {
                    variable = v
                    break
                  }
                }
              }
              
              if (variable) {
                evaluatedCondition = evaluatedCondition.replace(match, String(variable.value))
              }
            }
          }
          
          // Replace loop context variables
          evaluatedCondition = evaluatedCondition.replace(/<loop\.iteration>/g, scope.iteration.toString())
          evaluatedCondition = evaluatedCondition.replace(/<loop\.item>/g, JSON.stringify(scope.item))
          
          logger.debug('Evaluating while condition:', {
            original: whileCondition,
            afterSubstitution: evaluatedCondition,
            loopIteration: scope.iteration,
          })
          
          const result = Boolean(eval(`(${evaluatedCondition})`))
          logger.debug('While condition result:', { result })
          return result
        } catch (error) {
          logger.error('Failed to evaluate while condition:', {
            condition: whileCondition,
            error: error instanceof Error ? error.message : String(error),
          })
          return false
        }
      }

      default:
        return false
    }
  }

  /**
   * Execute a single block
   */
  private async executeBlock(
    node: DAGNode,
    context: ExecutionContext,
    loopScopes: Map<string, LoopScope>
  ): Promise<NormalizedBlockOutput> {
    const block = node.block
    const blockLog: BlockLog = {
      blockId: node.id,
      blockName: block.metadata?.name || '',
      blockType: block.metadata?.id || '',
      startedAt: new Date().toISOString(),
      endedAt: '',
      durationMs: 0,
      success: false,
    }

    try {
      // If this is the first node in a loop, initialize loop scope
      if (node.metadata.isLoopNode) {
        const loopId = node.metadata.loopId!
        const loopConfig = context.workflow?.loops?.[loopId]
        
        if (loopConfig && !loopScopes.has(loopId)) {
          // Initialize loop scope before first iteration
          const initialScope: LoopScope = {
            iteration: 0,
            currentIterationOutputs: new Map(),
            allIterationOutputs: [],
          }
          
          // For forEach, set up items
          if ((loopConfig as any).loopType === 'forEach') {
            let forEachItems = (loopConfig as any).forEachItems
            
            // Parse if string
            if (typeof forEachItems === 'string' && !forEachItems.startsWith('<')) {
              try {
                forEachItems = JSON.parse(forEachItems.replace(/'/g, '"'))
              } catch (e) {
                logger.error('Failed to parse forEach items during init:', forEachItems)
                forEachItems = []
              }
            }
            
            const items = Array.isArray(forEachItems)
              ? forEachItems
              : Object.entries(forEachItems || {})
            initialScope.items = items
            initialScope.maxIterations = items.length
            initialScope.item = items[0]
          }
          
          loopScopes.set(loopId, initialScope)
          logger.debug('Initialized loop scope:', { loopId, iteration: 0 })
        }
      }
      
      // Resolve inputs with DAG scoping
      const inputs = this.resolver.resolveInputs(block, node.id, context, loopScopes)

      // Call onBlockStart
      if (context.onBlockStart) {
        await context.onBlockStart(
          node.id,
          block.metadata?.name || 'Unnamed Block',
          block.metadata?.id || 'unknown'
        )
      }

      // Find handler
      const handler = this.blockHandlers.find((h) => h.canHandle(block))
      if (!handler) {
        throw new Error(`No handler found for block type: ${block.metadata?.id}`)
      }

      // Execute
      const startTime = performance.now()
      const rawOutput = await handler.execute(block, inputs, context)
      const executionTime = performance.now() - startTime

      // Handle streaming execution
      if (rawOutput && typeof rawOutput === 'object' && 'stream' in rawOutput && 'execution' in rawOutput) {
        // Streaming execution - for now, just extract the execution result
        // TODO: Handle streaming properly
        const streamingExec = rawOutput as StreamingExecution
        const output = (streamingExec.execution as any).output as NormalizedBlockOutput

        blockLog.success = true
        blockLog.output = output
        blockLog.durationMs = Math.round(executionTime)
        blockLog.endedAt = new Date().toISOString()
        context.blockLogs.push(blockLog)

        // Call onBlockComplete
        if (context.onBlockComplete) {
          const callbackData = {
            output,
            executionTime: Math.round(executionTime),
          }
          await context.onBlockComplete(
            node.id,
            block.metadata?.name || 'Unnamed Block',
            block.metadata?.id || 'unknown',
            callbackData
          )
        }

        return output
      }

      // Regular execution
      const output: NormalizedBlockOutput =
        typeof rawOutput === 'object' && rawOutput !== null ? rawOutput : { result: rawOutput }

      blockLog.success = true
      blockLog.output = output
      blockLog.durationMs = Math.round(executionTime)
      blockLog.endedAt = new Date().toISOString()
      context.blockLogs.push(blockLog)

      // Add to console
      if (!this.isChildExecution) {
        const addConsole = useConsoleStore.getState().addConsole
        addConsole({
          input: inputs,
          output,
          success: true,
          durationMs: blockLog.durationMs,
          startedAt: blockLog.startedAt,
          endedAt: blockLog.endedAt,
          workflowId: context.workflowId,
          blockId: node.id,
          executionId: this.contextExtensions.executionId,
          blockName: block.metadata?.name || 'Unnamed Block',
          blockType: block.metadata?.id || 'unknown',
        })
      }

      // Call onBlockComplete
      if (context.onBlockComplete) {
        const callbackData = {
          output,
          executionTime: Math.round(executionTime),
        }
        await context.onBlockComplete(
          node.id,
          block.metadata?.name || 'Unnamed Block',
          block.metadata?.id || 'unknown',
          callbackData
        )
      }

      return output
    } catch (error: any) {
      blockLog.success = false
      blockLog.error = error.message
      blockLog.endedAt = new Date().toISOString()
      blockLog.durationMs = new Date(blockLog.endedAt).getTime() - new Date(blockLog.startedAt).getTime()
      context.blockLogs.push(blockLog)

      logger.error(`Block execution failed: ${node.id}`, error)

      // Check for error path
      const hasErrorPath = node.block.metadata?.id !== BlockType.STARTER
      if (hasErrorPath) {
        return {
          error: error.message,
          status: 500,
        }
      }

      throw error
    }
  }

  private createExecutionContext(workflowId: string, startTime: Date): ExecutionContext {
    return {
      workflowId,
      workspaceId: this.contextExtensions.workspaceId,
      executionId: this.contextExtensions.executionId,
      isDeployedContext: this.contextExtensions.isDeployedContext || false,
      blockStates: new Map(),
      blockLogs: [],
      metadata: {
        startTime: startTime.toISOString(),
        duration: 0,
      },
      environmentVariables: this.environmentVariables,
      workflowVariables: this.workflowVariables,
      decisions: {
        router: new Map(),
        condition: new Map(),
      },
      loopIterations: new Map(),
      loopItems: new Map(),
      completedLoops: new Set(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      workflow: this.workflow,
      stream: this.contextExtensions.stream || false,
      selectedOutputs: this.contextExtensions.selectedOutputs || [],
      edges: this.contextExtensions.edges || [],
      onStream: this.contextExtensions.onStream,
      onBlockStart: this.contextExtensions.onBlockStart,
      onBlockComplete: this.contextExtensions.onBlockComplete,
    }
  }

  public cancel(): void {
    logger.info('Cancelling DAG execution')
    this.isCancelled = true
  }

  /**
   * Continue execution (for debug mode)
   * TODO: Implement step-through debugging for DAG executor
   */
  public async continueExecution(
    blockIds: string[],
    context: ExecutionContext
  ): Promise<ExecutionResult> {
    throw new Error('Debug mode not yet supported in DAG executor')
  }

  /**
   * Extract base block ID (remove branch suffix)
   */
  private extractBaseId(nodeId: string): string {
    return nodeId.replace(/₍\d+₎$/, '')
  }
}

