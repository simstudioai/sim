import { createLogger, type Logger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { combineExecutionAbortSignals } from '@/lib/core/execution-limits'
import { subscribeToExecutionCancellation } from '@/lib/execution/cancellation'
import { BlockType, EDGE } from '@/executor/constants'
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
import { projectResolvedSecretDiagnosticError } from '@/executor/utils/resolved-secret-content-projection'

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
  private cancellationController = new AbortController()
  private abortSignalListener: (() => void) | null = null
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
    this.context.abortSignal = combineExecutionAbortSignals(
      this.context.abortSignal
        ? [this.context.abortSignal, this.cancellationController.signal]
        : [this.cancellationController.signal]
    )
    this.initializeAbortHandler()
  }

  private async subscribeToCancellationSignal(): Promise<void> {
    if (!this.context.executionId) return
    const executionId = this.context.executionId
    this.cancellationUnsubscribe = await subscribeToExecutionCancellation(executionId, () => {
      this.execLogger.info('Execution cancelled via Redis signal', { executionId })
      this.signalCancelled()
    })
  }

  private initializeAbortHandler(): void {
    this.abortPromise = new Promise<void>((resolve) => {
      this.abortResolve = resolve
    })

    if (!this.context.abortSignal) return

    const signal = this.context.abortSignal
    if (signal.aborted) {
      this.signalCancelled(signal.reason)
      return
    }

    this.abortSignalListener = () => this.signalCancelled(signal.reason)
    signal.addEventListener('abort', this.abortSignalListener, { once: true })
  }

  private signalCancelled(reason: unknown = new DOMException('user', 'AbortError')): void {
    if (this.cancelledFlag) return
    this.cancelledFlag = true
    if (!this.cancellationController.signal.aborted) {
      this.cancellationController.abort(reason)
    }
    this.abortResolve()
  }

  private checkCancellation(): boolean {
    return this.cancelledFlag
  }

  async run(triggerBlockId?: string): Promise<ExecutionResult> {
    const startTime = performance.now()
    try {
      this.initializeQueue(triggerBlockId)
      await this.subscribeToCancellationSignal()

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
      this.ensureFinalOutputProvenance()

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
      this.ensureFinalOutputProvenance()

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
      this.execLogger.error(
        'Execution failed',
        projectResolvedSecretDiagnosticError(error, this.context.resolvedSecretTraceRegistry)
      )

      const executionResult: ExecutionResult = {
        success: false,
        output: this.finalOutput,
        error: errorMessage,
        logs: this.context.blockLogs,
        executionState: this.getSerializableExecutionState(),
        metadata: this.context.metadata,
      }

      if (error instanceof Error) {
        attachExecutionResult(error, executionResult)
      }
      throw error
    } finally {
      await this.cleanup()
    }
  }

  private async cleanup(): Promise<void> {
    if (this.abortSignalListener && this.context.abortSignal) {
      this.context.abortSignal.removeEventListener('abort', this.abortSignalListener)
      this.abortSignalListener = null
    }
    if (this.cancellationUnsubscribe) {
      this.cancellationUnsubscribe()
      this.cancellationUnsubscribe = null
    }

    const resources = this.context.runtimeResources
    if (!resources) return
    const callbacks = [...resources.cleanupCallbacks]
    resources.cleanupCallbacks.clear()
    resources.values.clear()
    const results = await Promise.allSettled(callbacks.map((callback) => callback()))
    for (const result of results) {
      if (result.status === 'rejected') {
        this.execLogger.warn('Execution runtime resource cleanup failed', {
          error: toError(result.reason).message,
        })
      }
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
        if (!targetNode) continue

        const sourceHandle = this.resolveRemainingEdgeHandle(edge)
        if (sourceHandle === EDGE.ERROR) {
          this.edgeManager.deactivateResumedEdge(edge.source, targetNode.id, sourceHandle)

          if (
            this.edgeManager.hasActivatedEdge(targetNode.id) &&
            this.edgeManager.isNodeReady(targetNode)
          ) {
            this.execLogger.info('Convergence node ready after pruning resumed error edge', {
              nodeId: targetNode.id,
            })
            this.addToQueue(targetNode.id)
          }
          continue
        }

        const hadEdge = targetNode.incomingEdges.has(edge.source)
        targetNode.incomingEdges.delete(edge.source)
        if (hadEdge) {
          this.edgeManager.markNodeWithActivatedEdge(targetNode.id)
        }

        if (this.edgeManager.isNodeReady(targetNode)) {
          this.execLogger.info('Node became ready after edge removal', { nodeId: targetNode.id })
          this.addToQueue(targetNode.id)
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

  /**
   * Resolves the source handle for an edge released during pause/resume.
   * Persisted `remainingEdges` may omit the handle, so fall back to the live DAG
   * edge. When a source has both a continuation and an `error` edge to the same
   * target, the continuation handle wins — a successful resume must not prune it.
   */
  private resolveRemainingEdgeHandle(edge: {
    source: string
    target: string
    sourceHandle?: string
  }): string | undefined {
    if (edge.sourceHandle !== undefined) return edge.sourceHandle

    const sourceNode = this.dag.nodes.get(edge.source)
    if (!sourceNode) return undefined

    let hasErrorEdge = false
    for (const [, outgoing] of sourceNode.outgoingEdges) {
      if (outgoing.target !== edge.target) continue
      if (outgoing.sourceHandle === EDGE.ERROR) {
        hasErrorEdge = true
        continue
      }
      return outgoing.sourceHandle
    }

    return hasErrorEdge ? EDGE.ERROR : undefined
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
      this.execLogger.error('Node execution failed', {
        nodeId,
        ...projectResolvedSecretDiagnosticError(error, this.context.resolvedSecretTraceRegistry),
      })
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
      await this.nodeOrchestrator.handleNodeCompletion(this.context, nodeId, output)

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
        this.setFinalOutput(nodeId, output)
        this.responseOutputLocked = true
      }
      this.stoppedEarlyFlag = true
      return
    }

    if (isFinalOutput && !this.responseOutputLocked) {
      this.setFinalOutput(nodeId, output)
    }

    if (this.context.stopAfterBlockId === nodeId) {
      // For loop/parallel sentinels, only stop if the subflow has fully exited (all iterations done)
      // shouldContinue: true means more iterations, shouldExit: true means loop is done
      const shouldContinue =
        output.shouldContinue === true || output.selectedRoute === EDGE.PARALLEL_CONTINUE
      if (!shouldContinue) {
        this.execLogger.info('Stopping execution after target block', { nodeId })
        this.stoppedEarlyFlag = true
        return
      }
    }

    const readyNodes = this.edgeManager.processOutgoingEdges(node, output, false)

    this.addMultipleToQueue(readyNodes)
  }

  private setFinalOutput(nodeId: string, output: NormalizedBlockOutput): void {
    this.finalOutput = output
    const state = this.context.blockStates.get(nodeId)
    if (state?.resolvedSecretTraceProvenance) {
      this.context.finalOutputResolvedSecretTraceProvenance = state.resolvedSecretTraceProvenance
      return
    }
    /**
     * A block state without provenance is an absence of a shortcut, not a verdict. Several state
     * writers legitimately store an output without one — a subflow sentinel aggregating iteration
     * results is the common case, and a loop that ran no iterations has nothing to merge — so
     * stamping an incomplete envelope here declared the run unvouchable whenever the last block
     * was one of them. Every other consumer of a provenance-less block state falls back to the run
     * registry; deriving does the same, against the value actually being described.
     */
    this.deriveFinalOutputProvenance()
  }

  /**
   * Derives the final-output envelope from the run registry. Fails closed on its own terms: a
   * latched registry exports an incomplete envelope, which is the genuinely unvouchable case.
   */
  private deriveFinalOutputProvenance(): void {
    const registry = this.context.resolvedSecretTraceRegistry
    if (!registry) return
    this.context.finalOutputResolvedSecretTraceProvenance =
      registry.exportCommittedProvenanceForValue(this.finalOutput)
  }

  private ensureFinalOutputProvenance(): void {
    if (Object.hasOwn(this.context, 'finalOutputResolvedSecretTraceProvenance')) return
    this.deriveFinalOutputProvenance()
  }

  private buildPausedResult(startTime: number): ExecutionResult {
    const endTime = performance.now()
    this.context.metadata.endTime = new Date().toISOString()
    this.context.metadata.duration = endTime - startTime
    this.context.metadata.status = 'paused'

    const snapshotSeed = serializePauseSnapshot(this.context, [], this.dag, this.edgeManager)
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
        snapshotSeed?.snapshot ??
        serializePauseSnapshot(this.context, [], this.dag, this.edgeManager).snapshot
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
