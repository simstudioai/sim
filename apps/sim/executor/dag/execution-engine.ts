/**
 * ExecutionEngine
 * 
 * Thin orchestrator that coordinates the execution of a workflow DAG.
 * Delegates to specialized components:
 * - ExecutionCoordinator: Queue and concurrency management
 * - EdgeManager: Graph traversal and edge activation
 * - NodeExecutionOrchestrator: Node execution lifecycle
 * 
 * This class simply wires these components together.
 */

import { createLogger } from '@/lib/logs/console/logger'
import type {
  ExecutionContext,
  ExecutionResult,
  NormalizedBlockOutput,
} from '@/executor/types'
import type { DAG } from './dag-builder'
import type { ExecutionCoordinator } from './execution-coordinator'
import type { EdgeManager } from './edge-manager'
import type { NodeExecutionOrchestrator } from './node-execution-orchestrator'

const logger = createLogger('ExecutionEngine')

const TRIGGER_BLOCK_TYPE = {
  START: 'start_trigger',
  STARTER: 'starter',
} as const

/**
 * Orchestrates workflow execution using specialized components
 */
export class ExecutionEngine {
  private finalOutput: NormalizedBlockOutput = {}

  constructor(
    private dag: DAG,
    private coordinator: ExecutionCoordinator,
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
        initialQueueSize: this.coordinator.getQueueSize(),
        startNodeId,
      })

      // Main execution loop
      while (this.coordinator.hasWork()) {
        await this.processQueue()
      }

      logger.debug('Execution loop completed', {
        finalOutputKeys: Object.keys(this.finalOutput),
      })

      // Wait for any remaining executions
      await this.coordinator.waitForAllExecutions()

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
   * PRIVATE METHODS
   */

  /**
   * Initialize the ready queue with the start node
   */
  private initializeQueue(startNodeId?: string): void {
    if (startNodeId) {
      this.coordinator.addToQueue(startNodeId)
      return
    }

    // Find the start/trigger node
    const startNode = Array.from(this.dag.nodes.values()).find(
      (node) =>
        node.block.metadata?.id === TRIGGER_BLOCK_TYPE.START ||
        node.block.metadata?.id === TRIGGER_BLOCK_TYPE.STARTER
    )

    if (startNode) {
      this.coordinator.addToQueue(startNode.id)
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
    while (this.coordinator.getQueueSize() > 0) {
      const nodeId = this.coordinator.dequeue()
      if (!nodeId) continue

      // Execute node asynchronously
      const promise = this.executeNodeAsync(nodeId)
      this.coordinator.trackExecution(promise)
    }

    // Wait for at least one execution to complete before continuing
    if (this.coordinator.getExecutingCount() > 0) {
      await this.coordinator.waitForAnyExecution()
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
      await this.coordinator.withQueueLock(async () => {
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
    this.coordinator.addMultipleToQueue(readyNodes)

    logger.debug('Node completion handled', {
      nodeId,
      readyNodesCount: readyNodes.length,
      queueSize: this.coordinator.getQueueSize(),
    })
  }
}
