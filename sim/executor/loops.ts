import { SerializedBlock, SerializedConnection, SerializedLoop } from '@/serializer/types'
import { ExecutionContext } from './types'

/**
 * Manages loop detection, iteration limits, and state resets.
 */
export class LoopManager {
  constructor(
    private loops: Record<string, SerializedLoop>,
    private defaultIterations: number = 5
  ) {}

  /**
   * Processes all loops and checks if any need to be iterated.
   * Resets blocks in loops that should iterate again.
   *
   * @param context - Current execution context
   * @returns Whether any loop has reached its maximum iterations
   */
  async processLoopIterations(context: ExecutionContext): Promise<boolean> {
    let hasLoopReachedMaxIterations = false

    // Nothing to do if no loops
    if (Object.keys(this.loops).length === 0) return hasLoopReachedMaxIterations

    // Check each loop to see if it should iterate
    for (const [loopId, loop] of Object.entries(this.loops)) {
      // Get current iteration count
      const currentIteration = context.loopIterations.get(loopId) || 0

      // If we've hit the iterations count, skip this loop and mark flag
      if (currentIteration >= loop.iterations) {
        hasLoopReachedMaxIterations = true
        continue
      }

      // Check if all blocks in the loop have been executed
      const allExecuted = this.allBlocksExecuted(loop.nodes, context)
      
      if (allExecuted) {
        // Increment iteration counter
        context.loopIterations.set(loopId, currentIteration + 1)

        // Check if we've now reached iterations limit after incrementing
        if (currentIteration + 1 >= loop.iterations) {
          hasLoopReachedMaxIterations = true
        }

        // Reset ALL blocks in the loop, not just blocks after the entry
        for (const nodeId of loop.nodes) {
          // Remove from executed blocks
          context.executedBlocks.delete(nodeId)

          // Make sure it's in the active execution path
          context.activeExecutionPath.add(nodeId)
        }

        // Important: Make sure the first block in the loop is marked as executable
        if (loop.nodes.length > 0) {
          // Find the first block in the loop (typically the one with fewest incoming connections)
          const firstBlockId = this.findEntryBlock(loop.nodes, context)
          if (firstBlockId) {
            // Make sure it's in the active path
            context.activeExecutionPath.add(firstBlockId)
          }
        }
      }
    }

    return hasLoopReachedMaxIterations
  }

  /**
   * Finds the entry block for a loop (the one that should be executed first).
   * Typically the block with the fewest incoming connections.
   *
   * @param nodeIds - IDs of nodes in the loop
   * @param context - Current execution context
   * @returns ID of the entry block
   */
  private findEntryBlock(nodeIds: string[], context: ExecutionContext): string | undefined {
    const blockConnectionCounts = new Map<string, number>()

    for (const nodeId of nodeIds) {
      const incomingCount = context.workflow!.connections.filter(
        (conn) => conn.target === nodeId
      ).length
      blockConnectionCounts.set(nodeId, incomingCount)
    }

    const sortedBlocks = [...nodeIds].sort(
      (a, b) => (blockConnectionCounts.get(a) || 0) - (blockConnectionCounts.get(b) || 0)
    )

    return sortedBlocks[0]
  }

  /**
   * Checks if all blocks in a list have been executed.
   *
   * @param nodeIds - IDs of nodes to check
   * @param context - Current execution context
   * @returns Whether all blocks have been executed
   */
  private allBlocksExecuted(nodeIds: string[], context: ExecutionContext): boolean {
    return nodeIds.every((nodeId) => context.executedBlocks.has(nodeId))
  }

  /**
   * Checks if a connection forms a feedback path in a loop.
   * A feedback path points to an earlier block in the loop.
   *
   * @param connection - Connection to check
   * @param blocks - All blocks in the workflow
   * @returns Whether the connection forms a feedback path
   */
  isFeedbackPath(connection: SerializedConnection, blocks: SerializedBlock[]): boolean {
    for (const [loopId, loop] of Object.entries(this.loops)) {
      if (loop.nodes.includes(connection.source) && loop.nodes.includes(connection.target)) {
        const sourceIndex = loop.nodes.indexOf(connection.source)
        const targetIndex = loop.nodes.indexOf(connection.target)

        if (targetIndex < sourceIndex) {
          const sourceBlock = blocks.find((b) => b.id === connection.source)
          const isCondition = sourceBlock?.metadata?.id === 'condition'

          return isCondition && connection.sourceHandle?.startsWith('condition-') === true
        }
      }
    }

    return false
  }

  /**
   * Gets the iterations for a loop.
   *
   * @param loopId - ID of the loop
   * @returns Iterations for the loop
   */
  getIterations(loopId: string): number {
    return this.loops[loopId]?.iterations || this.defaultIterations
  }
}
