import { SerializedBlock, SerializedConnection, SerializedLoop } from '@/serializer/types'
import { ExecutionContext } from './types'

/**
 * Manages loop detection, iteration limits, and state resets.
 */
export class LoopManager {
  constructor(
    private loops: Record<string, SerializedLoop>,
    private defaultMaxIterations: number = 5
  ) {}

  /**
   * Process all loops and check if any need to be iterated
   */
  async processLoopIterations(context: ExecutionContext): Promise<void> {
    // Nothing to do if no loops
    if (Object.keys(this.loops).length === 0) return

    // Check each loop to see if it should iterate
    for (const [loopId, loop] of Object.entries(this.loops)) {
      // Get current iteration count
      const currentIteration = context.loopIterations.get(loopId) || 0

      // If we've hit the max iterations, skip this loop
      if (currentIteration >= loop.maxIterations) {
        continue
      }

      // Check if loop should iterate again
      const shouldIterate = this.shouldIterateLoop(loopId, context)

      if (shouldIterate) {
        // Increment iteration counter
        context.loopIterations.set(loopId, currentIteration + 1)

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
  }

  /**
   * Find the entry block for a loop (the one that should be executed first)
   */
  private findEntryBlock(nodeIds: string[], context: ExecutionContext): string | undefined {
    // The entry block is usually the one with connections from outside the loop
    // or the one with the fewest incoming connections
    const blockConnectionCounts = new Map<string, number>()

    // Count incoming connections for each block in the loop
    for (const nodeId of nodeIds) {
      const incomingCount = context.workflow!.connections.filter(
        (conn) => conn.target === nodeId
      ).length
      blockConnectionCounts.set(nodeId, incomingCount)
    }

    // Sort by number of incoming connections (ascending)
    const sortedBlocks = [...nodeIds].sort(
      (a, b) => (blockConnectionCounts.get(a) || 0) - (blockConnectionCounts.get(b) || 0)
    )

    return sortedBlocks[0] // Return the block with fewest incoming connections
  }

  /**
   * Check if a loop should iterate again
   */
  private shouldIterateLoop(loopId: string, context: ExecutionContext): boolean {
    const loop = this.loops[loopId]
    if (!loop) return false

    // A loop should iterate if:
    // 1. All blocks in the loop have been executed
    // 2. At least one feedback path exists
    // 3. We haven't hit the max iterations

    // Check if all blocks in the loop have been executed
    const allBlocksExecuted = loop.nodes.every((nodeId) => context.executedBlocks.has(nodeId))

    if (!allBlocksExecuted) return false

    // Check if we've hit the max iterations
    const currentIteration = context.loopIterations.get(loopId) || 0
    const maxIterations = loop.maxIterations || this.defaultMaxIterations

    if (currentIteration >= maxIterations) return false

    // Check for feedback paths (outputs from condition blocks)
    // Find condition blocks in the loop
    const conditionBlocks = loop.nodes.filter((nodeId) => {
      const block = context.blockStates.get(nodeId)
      return block?.output?.response?.selectedConditionId !== undefined
    })

    // Check if any condition block has chosen a feedback path
    for (const conditionId of conditionBlocks) {
      const conditionState = context.blockStates.get(conditionId)
      if (!conditionState) continue

      const selectedPath = conditionState.output?.response?.selectedPath
      if (!selectedPath) continue

      // If the selected path is to an earlier block in the loop, this is a feedback path
      const targetIndex = loop.nodes.indexOf(selectedPath.blockId)
      const sourceIndex = loop.nodes.indexOf(conditionId)

      // Feedback path exists if target comes before source in loop
      if (targetIndex !== -1 && targetIndex < sourceIndex) {
        return true
      }
    }

    // No feedback paths found
    return false
  }

  /**
   * Reset block states for a new loop iteration
   */
  private resetLoopBlockStates(loopId: string, context: ExecutionContext): void {
    const loop = this.loops[loopId]
    if (!loop) return

    // Reset execution state for all blocks in the loop except the first one
    // (The first one will be the entry point for the next iteration)
    const nodesToReset = loop.nodes.slice(1)

    for (const nodeId of nodesToReset) {
      // Remove from executed blocks
      context.executedBlocks.delete(nodeId)

      // Keep the block state but mark as not executed
      const state = context.blockStates.get(nodeId)
      if (state) {
        context.blockStates.set(nodeId, {
          ...state,
          executed: false,
        })
      }
    }

    // Add the first node of the loop to the active execution path
    // so it will be picked up in the next execution layer
    if (loop.nodes.length > 0) {
      context.activeExecutionPath.add(loop.nodes[0])
    }
  }

  /**
   * Check if a connection forms a feedback path in a loop
   */
  isFeedbackPath(connection: SerializedConnection, blocks: SerializedBlock[]): boolean {
    // Find the loop containing both source and target
    for (const [loopId, loop] of Object.entries(this.loops)) {
      if (loop.nodes.includes(connection.source) && loop.nodes.includes(connection.target)) {
        // Get block positions in the loop
        const sourceIndex = loop.nodes.indexOf(connection.source)
        const targetIndex = loop.nodes.indexOf(connection.target)

        // A feedback path points to an earlier block in the loop
        if (targetIndex < sourceIndex) {
          // Check if source is a condition block
          const sourceBlock = blocks.find((b) => b.id === connection.source)
          const isCondition = sourceBlock?.metadata?.id === 'condition'

          // Only consider it a feedback path if it's from a condition block
          // and uses a condition handle
          return isCondition && connection.sourceHandle?.startsWith('condition-') === true
        }
      }
    }

    return false
  }

  /**
   * Get the maximum iterations for a loop
   */
  getMaxIterations(loopId: string): number {
    return this.loops[loopId]?.maxIterations || this.defaultMaxIterations
  }
}
