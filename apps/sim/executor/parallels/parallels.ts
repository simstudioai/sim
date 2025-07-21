import { createLogger } from '@/lib/logs/console-logger'
import type { ExecutionContext, NormalizedBlockOutput } from '@/executor/types'
import type { SerializedBlock, SerializedParallel, SerializedWorkflow } from '@/serializer/types'

const logger = createLogger('ParallelManager')

export interface ParallelState {
  parallelCount: number
  distributionItems: any[] | Record<string, any> | null
  completedExecutions: number
  executionResults: Map<string, any>
  activeIterations: Set<number>
  currentIteration: number
}

/**
 * Manages parallel block execution and state.
 * Handles distribution of items across parallel executions and tracking completion.
 */
export class ParallelManager {
  constructor(private parallels: SerializedWorkflow['parallels'] = {}) {}

  /**
   * Initializes a parallel execution state.
   */
  initializeParallel(
    parallelId: string,
    distributionItems: any[] | Record<string, any>
  ): ParallelState {
    const parallelCount = Array.isArray(distributionItems)
      ? distributionItems.length
      : Object.keys(distributionItems).length

    return {
      parallelCount,
      distributionItems,
      completedExecutions: 0,
      executionResults: new Map(),
      activeIterations: new Set(),
      currentIteration: 1,
    }
  }

  /**
   * Gets the current item for a specific parallel iteration.
   */
  getIterationItem(parallelState: ParallelState, iterationIndex: number): any {
    if (!parallelState.distributionItems) {
      return null
    }

    if (Array.isArray(parallelState.distributionItems)) {
      return parallelState.distributionItems[iterationIndex]
    }
    return Object.entries(parallelState.distributionItems)[iterationIndex]
  }

  /**
   * Checks if all virtual blocks for a parallel have been executed.
   */
  areAllVirtualBlocksExecuted(
    parallelId: string,
    parallel: SerializedParallel,
    executedBlocks: Set<string>,
    parallelState: ParallelState
  ): boolean {
    for (const nodeId of parallel.nodes) {
      for (let i = 0; i < parallelState.parallelCount; i++) {
        const virtualBlockId = `${nodeId}_parallel_${parallelId}_iteration_${i}`
        if (!executedBlocks.has(virtualBlockId)) {
          return false
        }
      }
    }
    return true
  }

  /**
   * Processes parallel iterations to check for completion and trigger re-execution.
   */
  async processParallelIterations(context: ExecutionContext): Promise<void> {
    if (!this.parallels || Object.keys(this.parallels).length === 0) {
      return
    }

    for (const [parallelId, parallel] of Object.entries(this.parallels)) {
      // Skip if this parallel has already been marked as completed
      if (context.completedLoops.has(parallelId)) {
        continue
      }

      // Check if the parallel block itself has been executed
      const parallelBlockExecuted = context.executedBlocks.has(parallelId)
      if (!parallelBlockExecuted) {
        continue
      }

      // Get the parallel state
      const parallelState = context.parallelExecutions?.get(parallelId)
      if (!parallelState || parallelState.currentIteration === 0) {
        continue
      }

      // Check if all virtual blocks have been executed
      const allVirtualBlocksExecuted = this.areAllVirtualBlocksExecuted(
        parallelId,
        parallel,
        context.executedBlocks,
        parallelState
      )

      if (allVirtualBlocksExecuted && !context.completedLoops.has(parallelId)) {
        // Check if the parallel block already has aggregated results stored
        const blockState = context.blockStates.get(parallelId)
        if (blockState?.output?.completed && blockState?.output?.results) {
          logger.info(
            `Parallel ${parallelId} already has aggregated results, marking as completed without re-execution`
          )
          // Just mark it as completed without re-execution
          context.completedLoops.add(parallelId)

          // Activate the parallel-end-source connections if not already done
          const parallelEndConnections =
            context.workflow?.connections.filter(
              (conn) => conn.source === parallelId && conn.sourceHandle === 'parallel-end-source'
            ) || []

          for (const conn of parallelEndConnections) {
            if (!context.activeExecutionPath.has(conn.target)) {
              context.activeExecutionPath.add(conn.target)
              logger.info(`Activated post-parallel path to ${conn.target}`)
            }
          }

          continue
        }

        logger.info(
          `All virtual blocks completed for parallel ${parallelId}, re-executing to aggregate results`
        )

        // Re-execute the parallel block to check completion and trigger end connections
        context.executedBlocks.delete(parallelId)
        context.activeExecutionPath.add(parallelId)

        // IMPORTANT: Remove child nodes from active execution path to prevent re-execution
        for (const nodeId of parallel.nodes) {
          context.activeExecutionPath.delete(nodeId)
        }
      }
    }
  }

  /**
   * Creates virtual block instances for parallel execution.
   */
  createVirtualBlockInstances(
    block: SerializedBlock,
    parallelId: string,
    parallelState: ParallelState,
    executedBlocks: Set<string>,
    activeExecutionPath: Set<string>
  ): string[] {
    const virtualBlockIds: string[] = []

    for (let i = 0; i < parallelState.parallelCount; i++) {
      const virtualBlockId = `${block.id}_parallel_${parallelId}_iteration_${i}`

      // Skip if this virtual instance was already executed
      if (executedBlocks.has(virtualBlockId)) {
        continue
      }

      // Check if this virtual instance is in the active path
      if (!activeExecutionPath.has(virtualBlockId) && !activeExecutionPath.has(block.id)) {
        continue
      }

      virtualBlockIds.push(virtualBlockId)
    }

    return virtualBlockIds
  }

  /**
   * Sets up iteration-specific context for a virtual block.
   */
  setupIterationContext(
    context: ExecutionContext,
    parallelInfo: { parallelId: string; iterationIndex: number }
  ): void {
    const parallelState = context.parallelExecutions?.get(parallelInfo.parallelId)
    if (parallelState?.distributionItems) {
      const currentItem = this.getIterationItem(parallelState, parallelInfo.iterationIndex)

      // Store the current item for this specific iteration
      const iterationKey = `${parallelInfo.parallelId}_iteration_${parallelInfo.iterationIndex}`
      context.loopItems.set(iterationKey, currentItem)
      context.loopItems.set(parallelInfo.parallelId, currentItem) // Backward compatibility
      context.loopIterations.set(parallelInfo.parallelId, parallelInfo.iterationIndex)

      logger.info(`Set up iteration context for ${iterationKey} with item:`, currentItem)
    }
  }

  /**
   * Stores the result of a parallel iteration.
   */
  storeIterationResult(
    context: ExecutionContext,
    parallelId: string,
    iterationIndex: number,
    output: NormalizedBlockOutput
  ): void {
    const parallelState = context.parallelExecutions?.get(parallelId)
    if (parallelState) {
      parallelState.executionResults.set(`iteration_${iterationIndex}`, output)
    }
  }
}
