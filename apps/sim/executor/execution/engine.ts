/**
 * ExecutionEngine
 * 
 * Orchestrates the execution of a workflow DAG.
 * Manages:
 * - Queue and concurrency (ready queue, promise tracking)
 * - Main execution loop (continuous queue processing)
 * - Coordination with EdgeManager and NodeExecutionOrchestrator
 */

import { createLogger } from '@/lib/logs/console/logger'
import type {
  ExecutionContext,
  ExecutionResult,
  NormalizedBlockOutput,
} from '@/executor/types'
import type { DAG } from '../dag/builder'
import type { EdgeManager } from './edge-manager'
import type { NodeExecutionOrchestrator } from '../orchestrators/node'

const logger = createLogger('ExecutionEngine')

const TRIGGER_BLOCK_TYPE = {
  START: 'start_trigger',
  STARTER: 'starter',
} as const

/**
 * Orchestrates workflow execution with built-in queue management
 */
export class ExecutionEngine {
  // Queue management (merged from ExecutionCoordinator)
  private readyQueue: string[] = []
  private executing = new Set<Promise<void>>()
  private queueLock = Promise.resolve()
  
  // Execution state
  private finalOutput: NormalizedBlockOutput = {}

  constructor(
    private dag: DAG,
    private edgeManager: EdgeManager,
    private nodeOrchestrator: NodeExecutionOrchestrator,
    private context: ExecutionContext
  ) {}

  /**
   * Run the workflow execution
   * Main execution loop that processes the queue until completion
   */
  async run(startNodeId?: string): Promise<ExecutionResult> {
    const startTime = Date.now()

    try {
      this.initializeQueue(startNodeId)

      logger.debug('Starting execution loop', {
        initialQueueSize: this.readyQueue.length,
        startNodeId,
      })

      // Main execution loop
      while (this.hasWork()) {
        await this.processQueue()
      }

      logger.debug('Execution loop completed', {
        finalOutputKeys: Object.keys(this.finalOutput),
      })

      // Wait for any remaining executions
      await this.waitForAllExecutions()

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

  /**
   * PRIVATE METHODS - Queue Management
   */

  /**
   * Check if there is work to be done
   * Work exists if there are nodes in the queue or promises executing
   */
  private hasWork(): boolean {
    return this.readyQueue.length > 0 || this.executing.size > 0
  }

  /**
   * Add a node to the ready queue
   * Nodes in the queue are ready to execute (all dependencies met)
   */
  private addToQueue(nodeId: string): void {
    if (!this.readyQueue.includes(nodeId)) {
      this.readyQueue.push(nodeId)
      logger.debug('Added to queue', { nodeId, queueLength: this.readyQueue.length })
    }
  }

  /**
   * Add multiple nodes to the ready queue at once
   */
  private addMultipleToQueue(nodeIds: string[]): void {
    for (const nodeId of nodeIds) {
      this.addToQueue(nodeId)
    }
  }

  /**
   * Get the next node from the queue (FIFO)
   * Returns undefined if queue is empty
   */
  private dequeue(): string | undefined {
    return this.readyQueue.shift()
  }

  /**
   * Track a promise for concurrent execution
   * The promise is automatically removed when it completes
   */
  private trackExecution(promise: Promise<void>): void {
    this.executing.add(promise)

    promise.finally(() => {
      this.executing.delete(promise)
    })
  }

  /**
   * Wait for any executing promise to complete
   * Used for concurrent execution coordination
   */
  private async waitForAnyExecution(): Promise<void> {
    if (this.executing.size > 0) {
      await Promise.race(this.executing)
    }
  }

  /**
   * Wait for all executing promises to complete
   * Used at the end of execution to ensure all work finishes
   */
  private async waitForAllExecutions(): Promise<void> {
    await Promise.all(Array.from(this.executing))
  }

  /**
   * Execute a function with queue lock
   * Ensures operations on the queue are atomic
   */
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

  /**
   * PRIVATE METHODS - Execution Flow
   */

  /**
   * Initialize the ready queue with the start node
   */
  private initializeQueue(startNodeId?: string): void {
    if (startNodeId) {
      this.addToQueue(startNodeId)
      return
    }

    // Find the start/trigger node
    const startNode = Array.from(this.dag.nodes.values()).find(
      (node) =>
        node.block.metadata?.id === TRIGGER_BLOCK_TYPE.START ||
        node.block.metadata?.id === TRIGGER_BLOCK_TYPE.STARTER
    )

    if (startNode) {
      this.addToQueue(startNode.id)
    } else {
      logger.warn('No start node found in DAG')
    }
  }

  /**
   * Process all nodes in the queue
   * Executes nodes concurrently and waits for any to complete
   */
  private async processQueue(): Promise<void> {
    // Dequeue and execute all ready nodes
    while (this.readyQueue.length > 0) {
      const nodeId = this.dequeue()
      if (!nodeId) continue

      // Execute node asynchronously
      const promise = this.executeNodeAsync(nodeId)
      this.trackExecution(promise)
    }

    // Wait for at least one execution to complete before continuing
    if (this.executing.size > 0) {
      await this.waitForAnyExecution()
    }
  }

  /**
   * Execute a single node asynchronously
   * Handles completion and edge processing
   */
  private async executeNodeAsync(nodeId: string): Promise<void> {
    try {
      // Execute the node
      const result = await this.nodeOrchestrator.executeNode(nodeId, this.context)

      // Handle completion with queue lock to ensure atomicity
      await this.withQueueLock(async () => {
        await this.handleNodeCompletion(nodeId, result.output, result.isFinalOutput)
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      logger.error('Node execution failed', { nodeId, error: errorMessage })
      throw error
    }
  }

  /**
   * Handle node completion
   * Processes edges and adds ready nodes to queue
   */
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

    // Handle node completion (loop/parallel/regular logic)
    await this.nodeOrchestrator.handleNodeCompletion(nodeId, output, this.context)

    // Track final output if this is a terminal node
    if (isFinalOutput) {
      this.finalOutput = output
    }

    // Process outgoing edges and get ready nodes
    const readyNodes = this.edgeManager.processOutgoingEdges(node, output, false)

    // Add ready nodes to queue
    this.addMultipleToQueue(readyNodes)

    logger.debug('Node completion handled', {
      nodeId,
      readyNodesCount: readyNodes.length,
      queueSize: this.readyQueue.length,
    })
  }
}
