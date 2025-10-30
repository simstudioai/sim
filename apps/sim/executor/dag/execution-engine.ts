import { createLogger } from '@/lib/logs/console/logger'
import type {
  ExecutionContext,
  ExecutionResult,
  NormalizedBlockOutput,
} from '@/executor/types'
import type { SerializedWorkflow } from '@/serializer/types'
import type { DAG, DAGNode } from './dag-builder'
import type { DAGEdge } from './types'
import type { ExecutionState } from './execution-state'
import type { BlockExecutor } from './block-executor'
import type { SubflowManager } from './subflow-manager'

const logger = createLogger('ExecutionEngine')

const EDGE_HANDLE = {
  CONDITION_PREFIX: 'condition-',
  ROUTER_PREFIX: 'router-',
  ERROR: 'error',
  SOURCE: 'source',
  LOOP_CONTINUE: 'loop_continue',
  LOOP_CONTINUE_ALT: 'loop-continue-source',
  DEFAULT: 'default',
} as const

const TRIGGER_BLOCK_TYPE = {
  START: 'start_trigger',
  STARTER: 'starter',
} as const

export class ExecutionEngine {
  private readyQueue: string[] = []
  private executing = new Set<Promise<void>>()
  private queueLock = Promise.resolve()
  private finalOutput: NormalizedBlockOutput = {}
  private deactivatedEdges = new Set<string>()

  constructor(
    private workflow: SerializedWorkflow,
    private dag: DAG,
    private state: ExecutionState,
    private blockExecutor: BlockExecutor,
    private subflowManager: SubflowManager,
    private context: ExecutionContext
  ) {}

  async run(startNodeId?: string): Promise<ExecutionResult> {
    const startTime = Date.now()

    try {
      this.initializeQueue(startNodeId)

      logger.debug('Starting execution loop', {
        initialQueueSize: this.readyQueue.length,
        startNodeId,
      })

      while (this.hasWork()) {
        await this.processQueue()
      }

      logger.debug('Execution loop completed', {
        finalOutputKeys: Object.keys(this.finalOutput),
      })

      await Promise.all(Array.from(this.executing))

      const endTime = Date.now()
      this.context.metadata.endTime = new Date(endTime).toISOString()
      this.context.metadata.duration = endTime - startTime

      return {
        success: true,
        output: this.finalOutput,
        logs: this.context.blockLogs,
        metadata: this.context.metadata,
      }
    } catch (error) {
      const endTime = Date.now()
      this.context.metadata.endTime = new Date(endTime).toISOString()
      this.context.metadata.duration = endTime - startTime

      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Execution failed', { error: errorMessage })

      const executionResult: ExecutionResult = {
        success: false,
        output: this.finalOutput,
        error: errorMessage,
        logs: this.context.blockLogs,
        metadata: this.context.metadata,
      }

      const executionError = new Error(errorMessage)
      ;(executionError as any).executionResult = executionResult
      throw executionError
    }
  }

  private initializeQueue(startNodeId?: string): void {
    if (startNodeId) {
      this.addToQueue(startNodeId)
      return
    }

    const startNode = Array.from(this.dag.nodes.values()).find(
      node => 
        node.block.metadata?.id === TRIGGER_BLOCK_TYPE.START || 
        node.block.metadata?.id === TRIGGER_BLOCK_TYPE.STARTER
    )

    if (startNode) {
      this.addToQueue(startNode.id)
    } else {
      logger.warn('No start node found in DAG')
    }
  }

  private hasWork(): boolean {
    return this.readyQueue.length > 0 || this.executing.size > 0
  }

  private async processQueue(): Promise<void> {
    while (this.readyQueue.length > 0) {
      const nodeId = this.readyQueue.shift()
      if (!nodeId) continue

      const promise = this.executeNode(nodeId)
      this.executing.add(promise)

      promise.finally(() => {
        this.executing.delete(promise)
      })
    }

    if (this.executing.size > 0) {
      await Promise.race(this.executing)
    }
  }

  private async executeNode(nodeId: string): Promise<void> {
    const node = this.dag.nodes.get(nodeId)
    if (!node) {
      logger.error('Node not found in DAG', { nodeId })
      return
    }

    if (this.state.hasExecuted(nodeId)) {
      logger.debug('Node already executed, skipping', { nodeId })
      return
    }

    try {
      const loopId = node.metadata.loopId
      if (loopId && !this.state.getLoopScope(loopId)) {
        logger.debug('Initializing loop scope before first execution', { loopId, nodeId })
        const scope = this.subflowManager.initializeLoopScope(loopId, this.context)
        this.state.setLoopScope(loopId, scope)
      }

      if (loopId && !this.subflowManager.shouldExecuteLoopNode(nodeId, loopId, this.context)) {
        return
      }

      logger.debug('Launching node execution', { nodeId })

      const output = await this.blockExecutor.execute(node, node.block, this.context)
      await this.handleNodeCompletion(node, output)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Node execution failed', { nodeId, error: errorMessage })
      throw error
    }
  }

  private async handleNodeCompletion(
    node: DAGNode,
    output: NormalizedBlockOutput
  ): Promise<void> {
    logger.debug('Handling node completion', {
      nodeId: node.id,
      hasLoopId: !!node.metadata.loopId,
      isParallelBranch: !!node.metadata.isParallelBranch,
      isSentinel: !!node.metadata.isSentinel,
    })

    await this.withQueueLock(async () => {
      const loopId = node.metadata.loopId
      const isParallelBranch = node.metadata.isParallelBranch
      const isSentinel = node.metadata.isSentinel

      // Sentinel nodes are handled as regular nodes - they manage their own loop logic
      if (isSentinel) {
        logger.debug('Handling sentinel node', { nodeId: node.id, loopId })
        this.handleRegularNode(node, output)
      } else if (loopId) {
        logger.debug('Handling loop node', { nodeId: node.id, loopId })
        this.handleLoopNodeOutput(node, output, loopId)
      } else if (isParallelBranch) {
        const parallelId = this.findParallelIdForNode(node.id)
        if (parallelId) {
          this.handleParallelNode(node, output, parallelId)
        } else {
          this.handleRegularNode(node, output)
        }
      } else {
        logger.debug('Handling regular node', { nodeId: node.id })
        this.handleRegularNode(node, output)
      }
    })
  }

  private findParallelIdForNode(nodeId: string): string | undefined {
    for (const [parallelId, config] of this.dag.parallelConfigs) {
      const nodes = (config as any).nodes || []
      const baseId = nodeId.replace(/₍\d+₎$/, '')
      if (nodes.includes(baseId)) {
        return parallelId
      }
    }
    return undefined
  }

  private handleLoopNodeOutput(node: DAGNode, output: NormalizedBlockOutput, loopId: string): void {
    // For nodes inside a loop (but not sentinel nodes), just track their output for collection
    // The sentinel_end node will handle iteration management and loop continuation
    
    logger.debug('Tracking loop node output', { loopId, nodeId: node.id })

    const scope = this.state.getLoopScope(loopId)
    if (scope) {
      const baseId = node.id.replace(/₍\d+₎$/, '')
      scope.currentIterationOutputs.set(baseId, output)
      logger.debug('Stored loop node output in iteration scope', {
        baseId,
        iteration: scope.iteration,
      })
    } else {
      logger.warn('Loop scope not found for loop node', { loopId, nodeId: node.id })
    }

    // Store output and process edges normally
    this.state.setBlockOutput(node.id, output)
    this.processEdges(node, output, false)
  }

  private handleParallelNode(node: DAGNode, output: NormalizedBlockOutput, parallelId: string): void {
    let scope = this.state.getParallelScope(parallelId)
    if (!scope) {
      const parallelConfig = this.dag.parallelConfigs.get(parallelId)
      if (parallelConfig) {
        const totalBranches = parallelConfig.count || (parallelConfig.distribution ? 
          (Array.isArray(parallelConfig.distribution) ? parallelConfig.distribution.length : Object.keys(parallelConfig.distribution as object).length) : 
          0
        )
        scope = this.subflowManager.initializeParallelScope(parallelId, totalBranches)
      }
    }

    const allComplete = this.subflowManager.handleParallelBranch(parallelId, node.id, output)

    if (allComplete) {
      this.processEdges(node, output, false)
    }
  }

  private handleRegularNode(node: DAGNode, output: NormalizedBlockOutput): void {
    this.state.setBlockOutput(node.id, output)

    if (node.outgoingEdges.size === 0) {
      this.finalOutput = output
    }

    // If this is a sentinel_end with loop_continue, clear executed state for loop nodes
    if (node.metadata.isSentinel && node.metadata.sentinelType === 'end' && output.selectedRoute === 'loop_continue') {
      const loopId = node.metadata.loopId
      if (loopId) {
        const loopConfig = this.dag.loopConfigs.get(loopId)
        if (loopConfig) {
          logger.debug('Clearing executed state and restoring edges for loop iteration', { loopId })
          
          const sentinelStartId = `loop-${loopId}-sentinel-start`
          const sentinelEndId = `loop-${loopId}-sentinel-end`
          const loopNodes = (loopConfig as any).nodes as string[]
          
          // Build set of all loop-related nodes
          const allLoopNodeIds = new Set([sentinelStartId, sentinelEndId, ...loopNodes])
          
          // Restore incoming edges for all loop nodes by scanning outgoing edges
          for (const nodeId of allLoopNodeIds) {
            const nodeToRestore = this.dag.nodes.get(nodeId)
            if (!nodeToRestore) continue
            
            // Find all nodes that have edges pointing to this node
            for (const [potentialSourceId, potentialSourceNode] of this.dag.nodes) {
              if (!allLoopNodeIds.has(potentialSourceId)) continue // Only from loop nodes
              
              for (const [edgeId, edge] of potentialSourceNode.outgoingEdges) {
                if (edge.target === nodeId) {
                  // Skip backward edges (they start inactive)
                  const isBackwardEdge = edge.sourceHandle === 'loop_continue' || edge.sourceHandle === 'loop-continue-source'
                  if (!isBackwardEdge) {
                    nodeToRestore.incomingEdges.add(potentialSourceId)
                    logger.debug('Restored incoming edge for loop node', {
                      from: potentialSourceId,
                      to: nodeId,
                    })
                  }
                }
              }
            }
          }
          
          // Clear executed state for all nodes in the loop (including both sentinels)
          this.state.executedBlocks.delete(sentinelStartId)
          this.state.executedBlocks.delete(sentinelEndId)
          
          for (const loopNodeId of loopNodes) {
            this.state.executedBlocks.delete(loopNodeId)
          }
        }
      }
    }

    this.processEdges(node, output, false)
  }

  private processEdges(node: DAGNode, output: NormalizedBlockOutput, skipBackwardsEdge: boolean): void {
    logger.debug('Processing outgoing edges', {
      nodeId: node.id,
      edgeCount: node.outgoingEdges.size,
      skipBackwardsEdge,
    })

    for (const [edgeId, edge] of node.outgoingEdges) {
      if (skipBackwardsEdge && this.isBackwardsEdge(edge.sourceHandle)) {
        logger.debug('Skipping backwards edge', { edgeId })
        continue
      }

      const shouldActivate = this.shouldActivateEdge(edge, output)
      
      if (!shouldActivate) {
        this.deactivateEdgeAndDescendants(node.id, edge.target, edge.sourceHandle)
        logger.debug('Edge deactivated', { 
          edgeId, 
          sourceHandle: edge.sourceHandle,
          from: node.id,
          to: edge.target,
        })
        continue
      }

      const targetNode = this.dag.nodes.get(edge.target)
      if (!targetNode) {
        logger.warn('Target node not found', { target: edge.target })
        continue
      }

      targetNode.incomingEdges.delete(node.id)

      logger.debug('Removed incoming edge', {
        from: node.id,
        target: edge.target,
        remainingIncomingEdges: targetNode.incomingEdges.size,
      })

      if (this.isNodeReady(targetNode)) {
        logger.debug('Node ready', { nodeId: targetNode.id })
        this.addToQueue(targetNode.id)
      }
    }
  }

  private deactivateEdgeAndDescendants(sourceId: string, targetId: string, sourceHandle?: string): void {
    const edgeKey = this.createEdgeKey(sourceId, targetId, sourceHandle)
    if (this.deactivatedEdges.has(edgeKey)) {
      return
    }
    this.deactivatedEdges.add(edgeKey)

    const targetNode = this.dag.nodes.get(targetId)
    if (!targetNode) return

    const hasOtherActiveIncoming = this.hasActiveIncomingEdges(targetNode, sourceId)

    if (!hasOtherActiveIncoming) {
      logger.debug('Deactivating descendants of unreachable node', { nodeId: targetId })
      for (const [_, outgoingEdge] of targetNode.outgoingEdges) {
        this.deactivateEdgeAndDescendants(targetId, outgoingEdge.target, outgoingEdge.sourceHandle)
      }
    }
  }

  private hasActiveIncomingEdges(node: DAGNode, excludeSourceId: string): boolean {
    for (const incomingSourceId of node.incomingEdges) {
      if (incomingSourceId === excludeSourceId) continue

      const incomingNode = this.dag.nodes.get(incomingSourceId)
      if (!incomingNode) continue

      for (const [_, incomingEdge] of incomingNode.outgoingEdges) {
        if (incomingEdge.target === node.id) {
          const incomingEdgeKey = this.createEdgeKey(incomingSourceId, node.id, incomingEdge.sourceHandle)
          if (!this.deactivatedEdges.has(incomingEdgeKey)) {
            return true
          }
        }
      }
    }
    return false
  }

  private createEdgeKey(sourceId: string, targetId: string, sourceHandle?: string): string {
    return `${sourceId}-${targetId}-${sourceHandle || EDGE_HANDLE.DEFAULT}`
  }

  private isNodeReady(node: DAGNode): boolean {
    if (node.incomingEdges.size === 0) {
      return true
    }

    const activeIncomingCount = this.countActiveIncomingEdges(node)

    if (activeIncomingCount > 0) {
      logger.debug('Node not ready - waiting for active incoming edges', {
        nodeId: node.id,
        totalIncoming: node.incomingEdges.size,
        activeIncoming: activeIncomingCount,
      })
      return false
    }

    logger.debug('Node ready - all remaining edges are deactivated', {
      nodeId: node.id,
      totalIncoming: node.incomingEdges.size,
    })
    return true
  }

  private countActiveIncomingEdges(node: DAGNode): number {
    let count = 0
    
    for (const sourceId of node.incomingEdges) {
      const sourceNode = this.dag.nodes.get(sourceId)
      if (!sourceNode) continue

      for (const [_, edge] of sourceNode.outgoingEdges) {
        if (edge.target === node.id) {
          const edgeKey = this.createEdgeKey(sourceId, edge.target, edge.sourceHandle)
          if (!this.deactivatedEdges.has(edgeKey)) {
            count++
            break
          }
        }
      }
    }
    
    return count
  }

  private shouldActivateEdge(edge: DAGEdge, output: NormalizedBlockOutput): boolean {
    const handle = edge.sourceHandle

    if (handle?.startsWith(EDGE_HANDLE.CONDITION_PREFIX)) {
      const conditionValue = handle.substring(EDGE_HANDLE.CONDITION_PREFIX.length)
      return output.selectedOption === conditionValue
    }

    if (handle?.startsWith(EDGE_HANDLE.ROUTER_PREFIX)) {
      const routeId = handle.substring(EDGE_HANDLE.ROUTER_PREFIX.length)
      return output.selectedRoute === routeId
    }

    // Handle loop continuation edges from sentinel_end
    if (handle === EDGE_HANDLE.LOOP_CONTINUE || handle === EDGE_HANDLE.LOOP_CONTINUE_ALT) {
      return output.selectedRoute === 'loop_continue'
    }

    // Handle loop exit edges from sentinel_end
    if (handle === 'loop_exit') {
      return output.selectedRoute === 'loop_exit'
    }

    if (handle === EDGE_HANDLE.ERROR && !output.error) {
      return false
    }

    if (handle === EDGE_HANDLE.SOURCE && output.error) {
      return false
    }

    return true
  }

  private isBackwardsEdge(sourceHandle?: string): boolean {
    return (
      sourceHandle === EDGE_HANDLE.LOOP_CONTINUE || 
      sourceHandle === EDGE_HANDLE.LOOP_CONTINUE_ALT
    )
  }

  private addToQueue(nodeId: string): void {
    if (!this.readyQueue.includes(nodeId)) {
      this.readyQueue.push(nodeId)
      logger.debug('Added to queue', { nodeId, queueLength: this.readyQueue.length })
    }
  }

  private async withQueueLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const prevLock = this.queueLock
    let resolveLock: () => void
    this.queueLock = new Promise(resolve => {
      resolveLock = resolve
    })

    await prevLock

    try {
      return await fn()
    } finally {
      resolveLock!()
    }
  }
}

