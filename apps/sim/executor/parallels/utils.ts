import { BlockType } from '@/executor/consts'
import type { ExecutionContext } from '@/executor/types'
import { ConnectionUtils } from '@/executor/utils/connections'
import { VirtualBlockUtils } from '@/executor/utils/virtual-blocks'
import type { SerializedParallel } from '@/serializer/types'

/**
 * Utility functions for parallel block conditional routing logic.
 * Shared between Executor and ParallelManager to ensure consistent behavior.
 */
export class ParallelRoutingUtils {
  /**
   * Determines if a block should execute in a specific parallel iteration
   * based on conditional routing and active execution paths.
   */
  static shouldBlockExecuteInParallelIteration(
    nodeId: string,
    parallel: SerializedParallel,
    iteration: number,
    context: ExecutionContext
  ): boolean {
    const internalConnections = ConnectionUtils.getInternalConnections(
      nodeId,
      parallel.nodes,
      context.workflow?.connections || []
    )

    // If no internal connections, check if this is truly a starting block or an unconnected block
    if (internalConnections.length === 0) {
      // Use helper to check if this is an unconnected block
      if (ConnectionUtils.isUnconnectedBlock(nodeId, context.workflow?.connections || [])) {
        return false
      }
      // If there are external connections, this is a legitimate starting block - should execute
      return true
    }

    // For blocks with dependencies within the parallel, check if any incoming connection is active
    // based on routing decisions made by executed source blocks
    return internalConnections.some((conn) => {
      const sourceVirtualId = VirtualBlockUtils.generateParallelId(
        conn.source,
        parallel.id,
        iteration
      )

      // Source must be executed for the connection to be considered
      if (!context.executedBlocks.has(sourceVirtualId)) {
        return false
      }

      // Get the source block to check its type
      const sourceBlock = context.workflow?.blocks.find((b) => b.id === conn.source)
      const sourceBlockType = sourceBlock?.metadata?.id

      // For condition blocks, check if the specific condition path was selected
      if (sourceBlockType === BlockType.CONDITION) {
        const selectedCondition = context.decisions.condition.get(sourceVirtualId)
        const expectedHandle = `condition-${selectedCondition}`
        return conn.sourceHandle === expectedHandle
      }

      // For router blocks, check if this specific target was selected
      if (sourceBlockType === BlockType.ROUTER) {
        const selectedTarget = context.decisions.router.get(sourceVirtualId)
        return selectedTarget === conn.target
      }

      // For regular blocks, the connection is active if the source executed successfully
      return true
    })
  }

  /**
   * Checks if all virtual blocks that SHOULD execute for a parallel have been executed.
   * Respects conditional routing - only checks blocks that should execute.
   */
  static areAllRequiredVirtualBlocksExecuted(
    parallel: SerializedParallel,
    parallelCount: number,
    executedBlocks: Set<string>,
    context: ExecutionContext
  ): boolean {
    for (const nodeId of parallel.nodes) {
      for (let i = 0; i < parallelCount; i++) {
        // Check if this specific block should execute in this iteration
        const shouldExecute = ParallelRoutingUtils.shouldBlockExecuteInParallelIteration(
          nodeId,
          parallel,
          i,
          context
        )

        if (shouldExecute) {
          const virtualBlockId = VirtualBlockUtils.generateParallelId(nodeId, parallel.id, i)
          if (!executedBlocks.has(virtualBlockId)) {
            return false
          }
        }
      }
    }

    return true
  }
}
