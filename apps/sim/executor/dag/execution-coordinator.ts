/**
 * ExecutionCoordinator
 * 
 * Manages the execution queue and concurrency:
 * - Ready queue management (nodes ready to execute)
 * - Promise coordination (concurrent execution tracking)
 * - Work detection (determining when execution is complete)
 * 
 * This is the single source of truth for queue-based execution flow.
 */

import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('ExecutionCoordinator')

/**
 * Manages the execution queue and concurrent block execution
 */
export class ExecutionCoordinator {
  private readyQueue: string[] = []
  private executing = new Set<Promise<void>>()
  private queueLock = Promise.resolve()

  /**
   * Add a node to the ready queue
   * Nodes in the queue are ready to execute (all dependencies met)
   */
  addToQueue(nodeId: string): void {
    if (!this.readyQueue.includes(nodeId)) {
      this.readyQueue.push(nodeId)
      logger.debug('Added to queue', { nodeId, queueLength: this.readyQueue.length })
    }
  }

  /**
   * Add multiple nodes to the ready queue at once
   */
  addMultipleToQueue(nodeIds: string[]): void {
    for (const nodeId of nodeIds) {
      this.addToQueue(nodeId)
    }
  }

  /**
   * Get the next node from the queue (FIFO)
   * Returns undefined if queue is empty
   */
  dequeue(): string | undefined {
    return this.readyQueue.shift()
  }

  /**
   * Check if there is work to be done
   * Work exists if there are nodes in the queue or promises executing
   */
  hasWork(): boolean {
    return this.readyQueue.length > 0 || this.executing.size > 0
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.readyQueue.length
  }

  /**
   * Get number of currently executing promises
   */
  getExecutingCount(): number {
    return this.executing.size
  }

  /**
   * Track a promise for concurrent execution
   * The promise is automatically removed when it completes
   */
  trackExecution(promise: Promise<void>): void {
    this.executing.add(promise)

    promise.finally(() => {
      this.executing.delete(promise)
    })
  }

  /**
   * Wait for any executing promise to complete
   * Used for concurrent execution coordination
   */
  async waitForAnyExecution(): Promise<void> {
    if (this.executing.size > 0) {
      await Promise.race(this.executing)
    }
  }

  /**
   * Wait for all executing promises to complete
   * Used at the end of execution to ensure all work finishes
   */
  async waitForAllExecutions(): Promise<void> {
    await Promise.all(Array.from(this.executing))
  }

  /**
   * Execute a function with queue lock
   * Ensures operations on the queue are atomic
   */
  async withQueueLock<T>(fn: () => Promise<T> | T): Promise<T> {
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
   * Clear the queue and all tracked executions
   * Used for cleanup or reset
   */
  clear(): void {
    this.readyQueue = []
    this.executing.clear()
    logger.debug('Cleared execution coordinator state')
  }
}

