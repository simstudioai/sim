import { createLogger } from '@sim/logger'
import { isExecutionCancelled, isRedisCancellationEnabled } from '@/lib/execution/cancellation'
import { BlockType } from '@/executor/constants'
import type { DAG } from '@/executor/dag/builder'
import type { EdgeManager } from '@/executor/execution/edge-manager'
import { serializePauseSnapshot } from '@/executor/execution/snapshot-serializer'
import type { NodeExecutionOrchestrator } from '@/executor/orchestrators/node'
import type {
  ExecutionContext,
  ExecutionResult,
  NormalizedBlockOutput,
  PauseMetadata,
  PausePoint,
  ResumeStatus,
} from '@/executor/types'
import { normalizeError } from '@/executor/utils/errors'

const logger = createLogger('ExecutionEngine')

export class ExecutionEngine {
  private readyQueue: string[] = []
  private executing = new Set<Promise<void>>()
  private queueLock = Promise.resolve()
  private finalOutput: NormalizedBlockOutput = {}
  private pausedBlocks: Map<string, PauseMetadata> = new Map()
  private allowResumeTriggers: boolean
  private cancelledFlag = false
  private lastCancellationCheck = 0
  private readonly useRedisCancellation: boolean
  private readonly CANCELLATION_CHECK_INTERVAL_MS = 500

  constructor(
    private context: ExecutionContext,
    private dag: DAG,
    private edgeManager: EdgeManager,
    private nodeOrchestrator: NodeExecutionOrchestrator
  ) {
    this.allowResumeTriggers = this.context.metadata.resumeFromSnapshot === true
    this.useRedisCancellation = isRedisCancellationEnabled() && !!this.context.executionId
  }

  private async checkCancellation(): Promise<boolean> {
    if (this.cancelledFlag) {
      return true
    }

    if (this.useRedisCancellation) {
      const now = Date.now()
      if (now - this.lastCancellationCheck < this.CANCELLATION_CHECK_INTERVAL_MS) {
        return false
      }
      this.lastCancellationCheck = now

      const cancelled = await isExecutionCancelled(this.context.executionId!)
      if (cancelled) {
        this.cancelledFlag = true
        logger.info('Execution cancelled via Redis', { executionId: this.context.executionId })
      }
      return cancelled
    }

    if (this.context.abortSignal?.aborted) {
      this.cancelledFlag = true
      return true
    }

    return false
  }

  async run(triggerBlockId?: string): Promise<ExecutionResult> {
    const startTime = Date.now()
    try {
      this.initializeQueue(triggerBlockId)

      while (this.hasWork()) {
        if ((await this.checkCancellation()) && this.executing.size === 0) {
          break
        }
        await this.processQueue()
      }
      await this.waitForAllExecutions()

      if (this.pausedBlocks.size > 0) {
        return this.buildPausedResult(startTime)
      }

      const endTime = Date.now()
      this.context.metadata.endTime = new Date(endTime).toISOString()
      this.context.metadata.duration = endTime - startTime

      if (this.cancelledFlag) {
        return {
          success: false,
          output: this.finalOutput,
          logs: this.context.blockLogs,
          metadata: this.context.metadata,
          status: 'cancelled',
        }
      }

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

      if (this.cancelledFlag) {
        return {
          success: false,
          output: this.finalOutput,
          logs: this.context.blockLogs,
          metadata: this.context.metadata,
          status: 'cancelled',
        }
      }

      const errorMessage = normalizeError(error)
      logger.error('Execution failed', { error: errorMessage })

      const executionResult: ExecutionResult = {
        success: false,
        output: this.finalOutput,
        error: errorMessage,
        logs: this.context.blockLogs,
        metadata: this.context.metadata,
      }

      if (error && typeof error === 'object') {
        ;(error as any).executionResult = executionResult
      }
      throw error
    }
  }

  private hasWork(): boolean {
    return this.readyQueue.length > 0 || this.executing.size > 0
  }

  private addToQueue(nodeId: string): void {
    const node = this.dag.nodes.get(nodeId)
    if (node?.metadata?.isResumeTrigger && !this.allowResumeTriggers) {
      return
    }

    if (!this.readyQueue.includes(nodeId)) {
      this.readyQueue.push(nodeId)
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
    // Attach error handler to prevent unhandled rejection warnings
    // The actual error handling happens in waitForAllExecutions/waitForAnyExecution
    promise.catch(() => {
      // Error will be properly handled by Promise.all/Promise.race in wait methods
    })
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
      this.addToQueue(triggerBlockId)
      return
    }

    const startNode = Array.from(this.dag.nodes.values()).find(
      (node) =>
        node.block.metadata?.id === BlockType.START_TRIGGER ||
        node.block.metadata?.id === BlockType.STARTER
    )
    if (startNode) {
      this.addToQueue(startNode.id)
    } else {
      logger.warn('No start node found in DAG')
    }
  }

  private async processQueue(): Promise<void> {
    while (this.readyQueue.length > 0) {
      if (await this.checkCancellation()) {
        break
      }
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
      const result = await this.nodeOrchestrator.executeNode(this.context, nodeId)

      if (!wasAlreadyExecuted) {
        await this.withQueueLock(async () => {
          await this.handleNodeCompletion(nodeId, result.output, result.isFinalOutput)
        })
      }
    } catch (error) {
      const errorMessage = normalizeError(error)
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

    if (output._pauseMetadata) {
      const pauseMetadata = output._pauseMetadata
      this.pausedBlocks.set(pauseMetadata.contextId, pauseMetadata)
      this.context.metadata.status = 'paused'
      this.context.metadata.pausePoints = Array.from(this.pausedBlocks.keys())

      return
    }

    await this.nodeOrchestrator.handleNodeCompletion(this.context, nodeId, output)

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

    // Check for dynamically added nodes (e.g., from parallel expansion)
    if (this.context.pendingDynamicNodes && this.context.pendingDynamicNodes.length > 0) {
      const dynamicNodes = this.context.pendingDynamicNodes
      this.context.pendingDynamicNodes = []
      logger.info('Adding dynamically expanded parallel nodes', { dynamicNodes })
      this.addMultipleToQueue(dynamicNodes)
    }
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
      resumeStatus: 'paused' as ResumeStatus,
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
