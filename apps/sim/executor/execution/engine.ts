import { createLogger } from '@/lib/logs/console/logger'
import { BlockType } from '@/executor/consts'
import type {
  ExecutionContext,
  ExecutionResult,
  NormalizedBlockOutput,
  PauseMetadata,
  PausePoint,
} from '@/executor/types'
import { serializePauseSnapshot } from '@/executor/execution/snapshot-serializer'
import type { DAG } from '../dag/builder'
import type { NodeExecutionOrchestrator } from '../orchestrators/node'
import type { EdgeManager } from './edge-manager'

import type { ExecutionState } from './state'

const logger = createLogger('ExecutionEngine')

export class ExecutionEngine {
  private readyQueue: string[] = []
  private executing = new Set<Promise<void>>()
  private queueLock = Promise.resolve()
  private finalOutput: NormalizedBlockOutput = {}
  private pausedBlocks: Map<string, PauseMetadata> = new Map()
  private allowResumeTriggers: boolean

  constructor(
    private dag: DAG,
    private edgeManager: EdgeManager,
    private nodeOrchestrator: NodeExecutionOrchestrator,
    private context: ExecutionContext,
    private state: ExecutionState
  ) {
    this.allowResumeTriggers = this.context.metadata.resumeFromSnapshot === true
  }

  async run(triggerBlockId?: string): Promise<ExecutionResult> {
    const startTime = Date.now()
    try {
      this.initializeQueue(triggerBlockId)
      logger.debug('Starting execution loop', {
        initialQueueSize: this.readyQueue.length,
        startNodeId: triggerBlockId,
      })

      while (this.hasWork()) {
        await this.processQueue()
      }

      logger.debug('Execution loop completed', {
        finalOutputKeys: Object.keys(this.finalOutput),
      })
      await this.waitForAllExecutions()

      if (this.pausedBlocks.size > 0) {
        logger.info('[ENGINE] Execution paused', {
          pausedBlocksCount: this.pausedBlocks.size,
          totalLogs: this.context.blockLogs.length,
          logBlocks: this.context.blockLogs.map(l => ({ 
            blockId: l.blockId, 
            blockName: l.blockName,
            iterationIndex: l.iterationIndex 
          })),
        })
        return this.buildPausedResult(startTime)
      }

      const endTime = Date.now()
      this.context.metadata.endTime = new Date(endTime).toISOString()
      this.context.metadata.duration = endTime - startTime

      logger.info('[ENGINE] Execution completed successfully', {
        totalLogs: this.context.blockLogs.length,
        logBlocks: this.context.blockLogs.map(l => ({ 
          blockId: l.blockId, 
          blockName: l.blockName,
          iterationIndex: l.iterationIndex 
        })),
      })

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

  private hasWork(): boolean {
    return this.readyQueue.length > 0 || this.executing.size > 0
  }

  private addToQueue(nodeId: string): void {
    const node = this.dag.nodes.get(nodeId)
    if (node?.metadata?.isResumeTrigger && !this.allowResumeTriggers) {
      logger.debug('Skipping enqueue for resume trigger node', { nodeId })
      return
    }

    if (!this.readyQueue.includes(nodeId)) {
      this.readyQueue.push(nodeId)
      logger.debug('Added to queue', { nodeId, queueLength: this.readyQueue.length })
    }
  }

  private addMultipleToQueue(nodeIds: string[]): void {
    for (const nodeId of nodeIds) {
      this.addToQueue(nodeId)
    }
  }

  private dequeue(): string | undefined {
    return this.readyQueue.shift()
  }

  private trackExecution(promise: Promise<void>): void {
    this.executing.add(promise)
    promise.finally(() => {
      this.executing.delete(promise)
    })
  }

  private async waitForAnyExecution(): Promise<void> {
    if (this.executing.size > 0) {
      await Promise.race(this.executing)
    }
  }

  private async waitForAllExecutions(): Promise<void> {
    await Promise.all(Array.from(this.executing))
  }

  private async withQueueLock<T>(fn: () => Promise<T> | T): Promise<T> {
    const prevLock = this.queueLock
    let resolveLock: () => void
    this.queueLock = new Promise((resolve) => {
      resolveLock = resolve
    })
    await prevLock
    try {
      return await fn()
    } finally {
      resolveLock!()
    }
  }

  private initializeQueue(triggerBlockId?: string): void {
    const pendingBlocks = this.context.metadata.pendingBlocks
    const remainingEdges = (this.context.metadata as any).remainingEdges
    
    // If we have remaining edges to remove (from resume), remove them first
    if (remainingEdges && Array.isArray(remainingEdges) && remainingEdges.length > 0) {
      logger.info('Removing edges from resumed pause blocks', {
        edgeCount: remainingEdges.length,
        edges: remainingEdges,
      })
      
      for (const edge of remainingEdges) {
        const targetNode = this.dag.nodes.get(edge.target)
        if (targetNode) {
          const hadEdge = targetNode.incomingEdges.has(edge.source)
          targetNode.incomingEdges.delete(edge.source)
          logger.debug('Removed edge from pause block', {
            source: edge.source,
            target: edge.target,
            hadEdge,
            remainingIncomingEdges: targetNode.incomingEdges.size,
          })
          
          // If this node is now ready (no more incoming edges), add it to queue
          if (this.edgeManager.isNodeReady(targetNode)) {
            logger.info('Node became ready after edge removal', { nodeId: targetNode.id })
            this.addToQueue(targetNode.id)
          }
        }
      }
      
      logger.info('Edge removal complete, queued ready nodes', {
        queueLength: this.readyQueue.length,
        queuedNodes: this.readyQueue,
      })
      
      return
    }
    
    if (pendingBlocks && pendingBlocks.length > 0) {
      logger.info('Initializing queue from pending blocks (resume mode)', {
        pendingBlocks,
        allowResumeTriggers: this.allowResumeTriggers,
        dagNodeCount: this.dag.nodes.size,
      })
      
      for (const nodeId of pendingBlocks) {
        logger.debug('Processing pending block', {
          nodeId,
          existsInDag: this.dag.nodes.has(nodeId),
          nodeMetadata: this.dag.nodes.get(nodeId)?.metadata,
        })
        this.addToQueue(nodeId)
      }
      
      logger.info('Pending blocks queued', {
        queueLength: this.readyQueue.length,
        queuedNodes: this.readyQueue,
      })
      
      this.context.metadata.pendingBlocks = []
      return
    }

    if (triggerBlockId) {
      logger.debug('Initializing queue with explicit trigger', { triggerBlockId })
      this.addToQueue(triggerBlockId)
      return
    }

    const startNode = Array.from(this.dag.nodes.values()).find(
      (node) =>
        node.block.metadata?.id === BlockType.START_TRIGGER ||
        node.block.metadata?.id === BlockType.STARTER
    )
    if (startNode) {
      logger.debug('Initializing queue with start node', { startNodeId: startNode.id })
      this.addToQueue(startNode.id)
    } else {
      logger.warn('No start node found in DAG')
    }
  }

  private async processQueue(): Promise<void> {
    while (this.readyQueue.length > 0) {
      const nodeId = this.dequeue()
      if (!nodeId) continue
      const promise = this.executeNodeAsync(nodeId)
      this.trackExecution(promise)
    }

    if (this.executing.size > 0) {
      await this.waitForAnyExecution()
    }
  }

  private async executeNodeAsync(nodeId: string): Promise<void> {
    try {
      const wasAlreadyExecuted = this.context.executedBlocks.has(nodeId)
      const node = this.dag.nodes.get(nodeId)
      
      logger.debug('Executing node', {
        nodeId,
        blockType: node?.block.metadata?.id,
        wasAlreadyExecuted,
        isResumeTrigger: node?.metadata?.isResumeTrigger,
        allowResumeTriggers: this.allowResumeTriggers,
      })
      
      const result = await this.nodeOrchestrator.executeNode(nodeId, this.context)
      
      logger.debug('Node execution completed', {
        nodeId,
        hasOutput: !!result.output,
        isFinalOutput: result.isFinalOutput,
        hasPauseMetadata: !!(result.output as any)?._pauseMetadata,
      })
      
      if (!wasAlreadyExecuted) {
        await this.withQueueLock(async () => {
          await this.handleNodeCompletion(nodeId, result.output, result.isFinalOutput)
        })
      } else {
        logger.debug('Node was already executed, skipping edge processing to avoid loops', {
          nodeId,
        })
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Node execution failed', { nodeId, error: errorMessage })
      throw error
    }
  }

  private async handleNodeCompletion(
    nodeId: string,
    output: NormalizedBlockOutput,
    isFinalOutput: boolean
  ): Promise<void> {
    const node = this.dag.nodes.get(nodeId)
    if (!node) {
      logger.error('Node not found during completion', { nodeId })
      return
    }

    logger.debug('Handling node completion', {
      nodeId,
      blockType: node.block.metadata?.id,
      isResumeTrigger: node.metadata?.isResumeTrigger,
      hasPauseMetadata: !!output._pauseMetadata,
      isFinalOutput,
      outgoingEdgesCount: node.outgoingEdges.size,
    })

    if (output._pauseMetadata) {
      const pauseMetadata = output._pauseMetadata
      this.pausedBlocks.set(pauseMetadata.contextId, pauseMetadata)
      this.context.metadata.status = 'paused'
      this.context.metadata.pausePoints = Array.from(this.pausedBlocks.keys())

      logger.debug('Registered pause metadata', {
        nodeId,
        contextId: pauseMetadata.contextId,
      })

      return
    }

    await this.nodeOrchestrator.handleNodeCompletion(nodeId, output, this.context)

    if (isFinalOutput) {
      this.finalOutput = output
    }

    const readyNodes = this.edgeManager.processOutgoingEdges(node, output, false)
    
    logger.info('Processing outgoing edges', {
      nodeId,
      outgoingEdgesCount: node.outgoingEdges.size,
      readyNodesCount: readyNodes.length,
      readyNodes,
    })
    
    this.addMultipleToQueue(readyNodes)

    logger.debug('Node completion handled', {
      nodeId,
      readyNodesCount: readyNodes.length,
      queueSize: this.readyQueue.length,
    })
  }

  private buildPausedResult(startTime: number): ExecutionResult {
    const endTime = Date.now()
    this.context.metadata.endTime = new Date(endTime).toISOString()
    this.context.metadata.duration = endTime - startTime
    this.context.metadata.status = 'paused'

    const snapshotSeed = serializePauseSnapshot(this.context, [], this.dag)
    const pausePoints: PausePoint[] = Array.from(this.pausedBlocks.values()).map((pause) => ({
      contextId: pause.contextId,
      blockId: pause.blockId,
      response: pause.response,
      registeredAt: pause.timestamp,
      resumeStatus: 'paused',
      snapshotReady: true,
      parallelScope: pause.parallelScope,
      loopScope: pause.loopScope,
      resumeLinks: pause.resumeLinks,
    }))

    return {
      success: true,
      output: this.collectPauseResponses(),
      logs: this.context.blockLogs,
      metadata: this.context.metadata,
      status: 'paused',
      pausePoints,
      snapshotSeed,
    }
  }

  private collectPauseResponses(): NormalizedBlockOutput {
    const responses = Array.from(this.pausedBlocks.values()).map((pause) => pause.response)

    if (responses.length === 1) {
      return responses[0]
    }

    return {
      pausedBlocks: responses,
      pauseCount: responses.length,
    }
  }
}
