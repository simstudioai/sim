import { createLogger, type Logger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  getCancellationChannel,
  isExecutionCancelled,
  isRedisCancellationEnabled,
} from '@/lib/execution/cancellation'
import { BlockType } from '@/executor/constants'
import type { DAG } from '@/executor/dag/builder'
import type { EdgeManager } from '@/executor/execution/edge-manager'
import { serializePauseSnapshot } from '@/executor/execution/snapshot-serializer'
import type { SerializableExecutionState } from '@/executor/execution/types'
import type { NodeExecutionOrchestrator } from '@/executor/orchestrators/node'
import type {
  ExecutionContext,
  ExecutionResult,
  NormalizedBlockOutput,
  PauseMetadata,
  PausePoint,
  ResumeStatus,
} from '@/executor/types'
import { attachExecutionResult, normalizeError } from '@/executor/utils/errors'

const logger = createLogger('ExecutionEngine')

export class ExecutionEngine {
  private readyQueue: string[] = []
  private executing = new Set<Promise<void>>()
  private queueLock = Promise.resolve()
  private finalOutput: NormalizedBlockOutput = {}
  private responseOutputLocked = false
  private pausedBlocks: Map<string, PauseMetadata> = new Map()
  private allowResumeTriggers: boolean
  private cancelledFlag = false
  private errorFlag = false
  private stoppedEarlyFlag = false
  private executionError: Error | null = null
  private abortPromise!: Promise<void>
  private abortResolve!: () => void
  private cancellationUnsubscribe: (() => void) | null = null
  private execLogger: Logger

  constructor(
    private context: ExecutionContext,
    private dag: DAG,
    private edgeManager: EdgeManager,
    private nodeOrchestrator: NodeExecutionOrchestrator
  ) {
    this.allowResumeTriggers = this.context.metadata.resumeFromSnapshot === true
    this.execLogger = logger.withMetadata({
      workflowId: this.context.workflowId,
      workspaceId: this.context.workspaceId,
      executionId: this.context.executionId,
      userId: this.context.userId,
      requestId: this.context.metadata.requestId,
    })
    this.initializeAbortHandler()
    this.subscribeToCancellationChannel()
  }

  private subscribeToCancellationChannel(): void {
    if (!this.context.executionId) return
    const executionId = this.context.executionId
    this.cancellationUnsubscribe = getCancellationChannel().subscribe((event) => {
      if (event.executionId !== executionId) return
      this.execLogger.info('Execution cancelled via pub/sub', { executionId })
      this.signalCancelled()
    })
  }

  private initializeAbortHandler(): void {
    this.abortPromise = new Promise<void>((resolve) => {
      this.abortResolve = resolve
    })

    if (!this.context.abortSignal) return

    if (this.context.abortSignal.aborted) {
      this.signalCancelled()
      return
    }

    this.context.abortSignal.addEventListener('abort', () => this.signalCancelled(), { once: true })
  }

  private signalCancelled(): void {
    if (this.cancelledFlag) return
    this.cancelledFlag = true
    this.abortResolve()
  }

  private checkCancellation(): boolean {
    return this.cancelledFlag
  }

  /** Catches cancellations published before this engine subscribed (e.g. resume from snapshot). */
  private async checkCancellationBackstop(): Promise<void> {
    if (!this.context.executionId || !isRedisCancellationEnabled()) return
    const cancelled = await isExecutionCancelled(this.context.executionId)
    if (cancelled) {
      this.execLogger.info('Execution already cancelled at engine start (Redis backstop)', {
        executionId: this.context.executionId,
      })
      this.signalCancelled()
    }
  }

  async run(triggerBlockId?: string): Promise<ExecutionResult> {
    const startTime = performance.now()
    try {
      this.initializeQueue(triggerBlockId)
      await this.checkCancellationBackstop()

      while (this.hasWork()) {
        if (this.checkCancellation() || this.errorFlag || this.stoppedEarlyFlag) {
          break
        }
        await this.processQueue()
      }

      if (!this.cancelledFlag) {
        await this.waitForAllExecutions()
      }

      if (this.errorFlag && this.executionError && !this.responseOutputLocked) {
        throw this.executionError
      }

      if (this.pausedBlocks.size > 0) {
        return this.buildPausedResult(startTime)
      }

      const endTime = performance.now()
      this.context.metadata.endTime = new Date().toISOString()
      this.context.metadata.duration = endTime - startTime

      if (this.cancelledFlag) {
        this.finalizeIncompleteLogs()
        return {
          success: false,
          output: this.finalOutput,
          logs: this.context.blockLogs,
          executionState: this.getSerializableExecutionState(),
          metadata: this.context.metadata,
          status: 'cancelled',
        }
      }

      return {
        success: true,
        output: this.finalOutput,
        logs: this.context.blockLogs,
        executionState: this.getSerializableExecutionState(),
        metadata: this.context.metadata,
      }
    } catch (error) {
      const endTime = performance.now()
      this.context.metadata.endTime = new Date().toISOString()
      this.context.metadata.duration = endTime - startTime

      if (this.cancelledFlag) {
        this.finalizeIncompleteLogs()
        return {
          success: false,
          output: this.finalOutput,
          logs: this.context.blockLogs,
          executionState: this.getSerializableExecutionState(),
          metadata: this.context.metadata,
          status: 'cancelled',
        }
      }

      this.finalizeIncompleteLogs()

      const errorMessage = normalizeError(error)
      this.execLogger.error('Execution failed', { error: errorMessage })

      const executionResult: ExecutionResult = {
        success: false,
        output: this.finalOutput,
        error: errorMessage,
        logs: this.context.blockLogs,
        metadata: this.context.metadata,
      }

      if (error instanceof Error) {
        attachExecutionResult(error, executionResult)
      }
      throw error
    } finally {
      this.cleanup()
    }
  }

  private cleanup(): void {
    if (this.cancellationUnsubscribe) {
      this.cancellationUnsubscribe()
      this.cancellationUnsubscribe = null
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
    const trackedPromise = promise
      .catch((error) => {
        if (!this.errorFlag) {
          this.errorFlag = true
          this.executionError = toError(error)
        }
      })
      .finally(() => {
        this.executing.delete(trackedPromise)
      })
    this.executing.add(trackedPromise)
  }

  private async waitForAnyExecution(): Promise<void> {
    if (this.executing.size > 0) {
      await Promise.race([...this.executing, this.abortPromise])
    }
  }

  private async waitForAllExecutions(): Promise<void> {
    await Promise.race([Promise.all(this.executing), this.abortPromise])
    if (this.executing.size > 0) {
      await Promise.allSettled(this.executing)
    }
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
    if (this.context.runFromBlockContext) {
      const { startBlockId } = this.context.runFromBlockContext
      this.execLogger.info('Initializing queue for run-from-block mode', {
        startBlockId,
        dirtySetSize: this.context.runFromBlockContext.dirtySet.size,
      })
      this.addToQueue(startBlockId)
      return
    }

    const pendingBlocks = this.context.metadata.pendingBlocks
    const remainingEdges = (this.context.metadata as any).remainingEdges

    if (remainingEdges && Array.isArray(remainingEdges) && remainingEdges.length > 0) {
      this.execLogger.info('Removing edges from resumed pause blocks', {
        edgeCount: remainingEdges.length,
        edges: remainingEdges,
      })

      for (const edge of remainingEdges) {
        const targetNode = this.dag.nodes.get(edge.target)
        if (targetNode) {
          const hadEdge = targetNode.incomingEdges.has(edge.source)
          targetNode.incomingEdges.delete(edge.source)

          if (this.edgeManager.isNodeReady(targetNode)) {
            this.execLogger.info('Node became ready after edge removal', { nodeId: targetNode.id })
            this.addToQueue(targetNode.id)
          }
        }
      }

      this.execLogger.info('Edge removal complete, queued ready nodes', {
        queueLength: this.readyQueue.length,
        queuedNodes: this.readyQueue,
      })

      return
    }

    if (pendingBlocks && pendingBlocks.length > 0) {
      this.execLogger.info('Initializing queue from pending blocks (resume mode)', {
        pendingBlocks,
        allowResumeTriggers: this.allowResumeTriggers,
        dagNodeCount: this.dag.nodes.size,
      })

      for (const nodeId of pendingBlocks) {
        this.addToQueue(nodeId)
      }

      this.execLogger.info('Pending blocks queued', {
        queueLength: this.readyQueue.length,
        queuedNodes: this.readyQueue,
      })

      this.context.metadata.pendingBlocks = []
      return
    }

    if (this.context.metadata.resumeFromSnapshot === true) {
      this.execLogger.info('Resume snapshot has no downstream work to queue')
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
      this.execLogger.warn('No start node found in DAG')
    }
  }

  private async processQueue(): Promise<void> {
    while (this.readyQueue.length > 0) {
      if (this.checkCancellation() || this.errorFlag) {
        break
      }
      const nodeId = this.dequeue()
      if (!nodeId) continue
      const promise = this.executeNodeAsync(nodeId)
      this.trackExecution(promise)
    }

    if (this.executing.size > 0 && !this.cancelledFlag && !this.errorFlag) {
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
      this.execLogger.error('Node execution failed', { nodeId, error: errorMessage })
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
      this.execLogger.error('Node not found during completion', { nodeId })
      return
    }

    if (this.stoppedEarlyFlag && this.responseOutputLocked) {
      // Workflow already ended via Response block. Skip state persistence (setBlockOutput),
      // parallel/loop scope tracking, and edge propagation — no downstream blocks will run.
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

    const isResponseBlock = node.block.metadata?.id === BlockType.RESPONSE
    if (isResponseBlock) {
      if (!this.responseOutputLocked) {
        this.finalOutput = output
        this.responseOutputLocked = true
      }
      this.stoppedEarlyFlag = true
      return
    }

    if (isFinalOutput && !this.responseOutputLocked) {
      this.finalOutput = output
    }

    if (this.context.stopAfterBlockId === nodeId) {
      // For loop/parallel sentinels, only stop if the subflow has fully exited (all iterations done)
      // shouldContinue: true means more iterations, shouldExit: true means loop is done
      const shouldContinueLoop = output.shouldContinue === true
      if (!shouldContinueLoop) {
        this.execLogger.info('Stopping execution after target block', { nodeId })
        this.stoppedEarlyFlag = true
        return
      }
    }

    const readyNodes = this.edgeManager.processOutgoingEdges(node, output, false)

    this.addMultipleToQueue(readyNodes)

    if (this.context.pendingDynamicNodes && this.context.pendingDynamicNodes.length > 0) {
      const dynamicNodes = this.context.pendingDynamicNodes
      this.context.pendingDynamicNodes = []
      this.execLogger.info('Adding dynamically expanded parallel nodes', { dynamicNodes })
      this.addMultipleToQueue(dynamicNodes)
    }
  }

  private buildPausedResult(startTime: number): ExecutionResult {
    const endTime = performance.now()
    this.context.metadata.endTime = new Date().toISOString()
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
      pauseKind: pause.pauseKind,
      resumeAt: pause.resumeAt,
    }))

    return {
      success: true,
      output: this.collectPauseResponses(),
      logs: this.context.blockLogs,
      executionState: this.getSerializableExecutionState(snapshotSeed),
      metadata: this.context.metadata,
      status: 'paused',
      pausePoints,
      snapshotSeed,
    }
  }

  private getSerializableExecutionState(snapshotSeed?: {
    snapshot: string
  }): SerializableExecutionState | undefined {
    try {
      const serializedSnapshot =
        snapshotSeed?.snapshot ?? serializePauseSnapshot(this.context, [], this.dag).snapshot
      const parsedSnapshot = JSON.parse(serializedSnapshot) as {
        state?: SerializableExecutionState
      }
      return parsedSnapshot.state
    } catch (error) {
      this.execLogger.warn('Failed to serialize execution state', {
        error: toError(error).message,
      })
      return undefined
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

  /**
   * Finalizes any block logs that were still running when execution was cancelled.
   * Sets their endedAt to now and calculates the actual elapsed duration.
   */
  private finalizeIncompleteLogs(): void {
    const now = new Date()
    const nowIso = now.toISOString()

    for (const log of this.context.blockLogs) {
      if (!log.endedAt) {
        log.endedAt = nowIso
        log.durationMs = now.getTime() - new Date(log.startedAt).getTime()
      }
    }
  }
}
