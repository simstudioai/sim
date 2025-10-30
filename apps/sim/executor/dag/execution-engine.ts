/**
 * ExecutionEngine
 * 
 * Main execution loop that coordinates block execution.
 * Manages the queue, processes edges, handles subflows.
 */

import { createLogger } from '@/lib/logs/console/logger'
import type {
  ExecutionContext,
  ExecutionResult,
  NormalizedBlockOutput,
} from '@/executor/types'
import type { SerializedWorkflow } from '@/serializer/types'
import type { DAG, DAGNode } from './dag-builder'
import type { ExecutionState } from './execution-state'
import type { BlockExecutor } from './block-executor'
import type { SubflowManager } from './subflow-manager'

const logger = createLogger('ExecutionEngine')

export class ExecutionEngine {
  private readyQueue: string[] = []
  private executing = new Set<Promise<void>>()
  private queueLock = Promise.resolve()
  private finalOutput: NormalizedBlockOutput = {}
  private deactivatedEdges = new Set<string>() // Edges that won't execute due to condition/router/error branching

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
  }

  private initializeQueue(startNodeId?: string): void {
    if (startNodeId) {
      this.addToQueue(startNodeId)
      return
    }

    const startNodes = Array.from(this.dag.nodes.values()).filter(
      node => node.incomingEdges.size === 0
    )

    for (const node of startNodes) {
      this.addToQueue(node.id)
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

    try {
      const output = await this.blockExecutor.execute(node, node.block, this.context)
      await this.handleNodeCompletion(node, output)
    } catch (error) {
      logger.error('Node execution failed', { nodeId, error })
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
    })

    await this.withQueueLock(async () => {
      const loopId = node.metadata.loopId
      const isParallelBranch = node.metadata.isParallelBranch

      if (loopId) {
        logger.debug('Handling loop node', { nodeId: node.id, loopId })
        this.handleLoopNode(node, output, loopId)
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

  private handleLoopNode(node: DAGNode, output: NormalizedBlockOutput, loopId: string): void {
    const loopConfig = this.dag.loopConfigs.get(loopId)
    if (!loopConfig) {
      logger.error('Loop config not found', { loopId })
      return
    }

    logger.debug('Handling loop iteration', { loopId, nodeId: node.id })

    const scope = this.state.getLoopScope(loopId)
    if (!scope) {
      logger.error('Loop scope not found - should have been initialized before execution', { loopId })
      return
    }

    const result = this.subflowManager.handleLoopIteration(loopId, node.id, output, this.context)

    logger.debug('Loop iteration result', {
      shouldContinue: result.shouldContinue,
      nextNodeId: result.nextNodeId,
    })

    if (result.shouldContinue && result.nextNodeId) {
      logger.debug('Loop continuing to next iteration (backwards edge)')
      for (const loopNodeId of (loopConfig as any).nodes) {
        this.state.executedBlocks.delete(loopNodeId)
      }
      this.addToQueue(result.nextNodeId)
    } else if (result.shouldContinue && !result.nextNodeId) {
      logger.debug('Processing edges within loop (not last node)')
      this.processEdges(node, output, false)
    } else {
      logger.debug('Loop exiting, processing exit edges')
      this.processEdges(node, output, true)
    }
  }

  private handleParallelNode(node: DAGNode, output: NormalizedBlockOutput, parallelId: string): void {
    let scope = this.state.getParallelScope(parallelId)
    if (!scope) {
      const parallelConfig = this.dag.parallelConfigs.get(parallelId)
      if (parallelConfig) {
        const totalBranches = parallelConfig.branches
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

      // Check if this edge should be activated based on condition/router output
      const shouldActivate = this.shouldActivateEdge(edge, output)
      
      if (!shouldActivate) {
        // Mark this edge as deactivated and deactivate all downstream edges
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

      // Check if node is ready by counting only active incoming edges
      if (this.isNodeReady(targetNode)) {
        logger.debug('Node ready', { nodeId: targetNode.id })
        this.addToQueue(targetNode.id)
      }
    }
  }

  private deactivateEdgeAndDescendants(sourceId: string, targetId: string, sourceHandle?: string): void {
    // Mark this edge as deactivated
    const edgeKey = `${sourceId}-${targetId}-${sourceHandle || 'default'}`
    if (this.deactivatedEdges.has(edgeKey)) {
      return // Already deactivated
    }
    this.deactivatedEdges.add(edgeKey)

    // Get the target node
    const targetNode = this.dag.nodes.get(targetId)
    if (!targetNode) return

    // Check if target node has any other active incoming edges
    let hasOtherActiveIncoming = false
    for (const incomingSourceId of targetNode.incomingEdges) {
      if (incomingSourceId === sourceId) continue // Skip the edge we just deactivated

      const incomingNode = this.dag.nodes.get(incomingSourceId)
      if (!incomingNode) continue

      // Check if there's an active edge from this source
      for (const [_, incomingEdge] of incomingNode.outgoingEdges) {
        if (incomingEdge.target === targetId) {
          const incomingEdgeKey = `${incomingSourceId}-${targetId}-${incomingEdge.sourceHandle || 'default'}`
          if (!this.deactivatedEdges.has(incomingEdgeKey)) {
            hasOtherActiveIncoming = true
            break
          }
        }
      }

      if (hasOtherActiveIncoming) break
    }

    // If target has no other active incoming edges, deactivate all its outgoing edges
    if (!hasOtherActiveIncoming) {
      logger.debug('Deactivating descendants of unreachable node', { nodeId: targetId })
      for (const [_, outgoingEdge] of targetNode.outgoingEdges) {
        this.deactivateEdgeAndDescendants(targetId, outgoingEdge.target, outgoingEdge.sourceHandle)
      }
    }
  }

  private isNodeReady(node: DAGNode): boolean {
    // Node is ready if it has no remaining incoming edges
    if (node.incomingEdges.size === 0) {
      return true
    }

    // Check if all remaining incoming edges are deactivated
    // If so, the node is ready because it's waiting for edges that will never fire
    let activeIncomingCount = 0
    
    for (const sourceId of node.incomingEdges) {
      // Find the edge from this source to this node
      const sourceNode = this.dag.nodes.get(sourceId)
      if (!sourceNode) continue

      // Check if there's an active edge from source to this node
      for (const [_, edge] of sourceNode.outgoingEdges) {
        if (edge.target === node.id) {
          const edgeKey = `${sourceId}-${edge.target}-${edge.sourceHandle || 'default'}`
          if (!this.deactivatedEdges.has(edgeKey)) {
            activeIncomingCount++
            break
          }
        }
      }
    }

    // If there are still active incoming edges waiting, node is not ready
    if (activeIncomingCount > 0) {
      logger.debug('Node not ready - waiting for active incoming edges', {
        nodeId: node.id,
        totalIncoming: node.incomingEdges.size,
        activeIncoming: activeIncomingCount,
      })
      return false
    }

    // All remaining incoming edges are deactivated, so node is ready
    logger.debug('Node ready - all remaining edges are deactivated', {
      nodeId: node.id,
      totalIncoming: node.incomingEdges.size,
    })
    return true
  }

  private shouldActivateEdge(edge: any, output: NormalizedBlockOutput): boolean {
    if (edge.sourceHandle?.startsWith('condition-')) {
      const conditionValue = edge.sourceHandle.substring('condition-'.length)
      return output.selectedOption === conditionValue
    }

    if (edge.sourceHandle?.startsWith('router-')) {
      const routeId = edge.sourceHandle.substring('router-'.length)
      return output.selectedRoute === routeId
    }

    // For error handles: if we have a success output, deactivate error edge
    if (edge.sourceHandle === 'error' && !output.error) {
      return false
    }

    // For success handles: if we have an error, deactivate success edge
    if (edge.sourceHandle === 'source' && output.error) {
      return false
    }

    return true
  }

  private isBackwardsEdge(sourceHandle?: string): boolean {
    return sourceHandle === 'loop_continue' || sourceHandle === 'loop-continue-source'
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

