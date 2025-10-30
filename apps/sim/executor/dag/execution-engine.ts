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

      if (!this.shouldActivateEdge(edge, output)) {
        logger.debug('Edge not activated', { edgeId, sourceHandle: edge.sourceHandle })
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

      if (targetNode.incomingEdges.size === 0) {
        logger.debug('Node ready', { nodeId: targetNode.id })
        this.addToQueue(targetNode.id)
      }
    }
  }

  private shouldActivateEdge(edge: any, output: NormalizedBlockOutput): boolean {
    if (edge.sourceHandle?.startsWith('condition-')) {
      const conditionValue = edge.sourceHandle.split('-')[1]
      return output.selectedOption === conditionValue
    }

    if (edge.sourceHandle?.startsWith('router-')) {
      const routeId = edge.sourceHandle.split('-')[1]
      return output.selectedRoute === routeId
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

