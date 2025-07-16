import { createLogger } from '@/lib/logs/console-logger'
import { BlockType } from '@/executor/consts'
import type { ExecutionContext } from '@/executor/types'
import type { SerializedBlock, SerializedConnection, SerializedLoop } from '@/serializer/types'

const logger = createLogger('LoopManager')

/**
 * Manages loop detection, iteration limits, and state resets.
 * With the new loop block approach, this class is significantly simplified.
 */
export class LoopManager {
  constructor(
    private loops: Record<string, SerializedLoop>,
    private defaultIterations = 5
  ) {}

  /**
   * Processes all loops and checks if any need to be iterated.
   * This is called after each execution layer to handle loop iterations.
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
      // Skip if this loop has already been marked as completed
      if (context.completedLoops.has(loopId)) {
        continue
      }

      // Check if the loop block itself has been executed
      const loopBlockExecuted = context.executedBlocks.has(loopId)
      if (!loopBlockExecuted) {
        // Loop block hasn't been executed yet, skip processing
        continue
      }

      // Check if all blocks in the loop have been executed
      const allBlocksInLoopExecuted = this.allBlocksExecuted(loop.nodes, context)

      logger.info(`Loop ${loopId} - Processing iteration check`)
      logger.info(`  Loop block executed: ${loopBlockExecuted}`)
      logger.info(`  All blocks executed: ${allBlocksInLoopExecuted}`)
      logger.info(`  Blocks in loop: ${loop.nodes.join(', ')}`)
      logger.info(`  Current iteration: ${context.loopIterations.get(loopId) || 0}`)

      if (allBlocksInLoopExecuted) {
        // All blocks in the loop have been executed
        const currentIteration = context.loopIterations.get(loopId) || 0

        // Store the results from this iteration before potentially resetting blocks
        const iterationResults: any[] = []
        for (const nodeId of loop.nodes) {
          const blockState = context.blockStates.get(nodeId)
          if (blockState?.output) {
            // Just push the output directly, not nested under block ID
            iterationResults.push(blockState.output)
          }
        }

        // Store the iteration results
        if (iterationResults.length > 0) {
          this.storeIterationResult(
            context,
            loopId,
            currentIteration - 1,
            'iteration',
            iterationResults
          )
        }

        // The loop block will handle incrementing the iteration when it executes next
        // We just need to reset the blocks so they can run again

        // Determine the maximum iterations
        let maxIterations = loop.iterations || this.defaultIterations

        // For forEach loops, use the actual items length
        if (loop.loopType === 'forEach' && loop.forEachItems) {
          // First check if the items have already been evaluated and stored by the loop handler
          const storedItems = context.loopItems.get(`${loopId}_items`)
          if (storedItems) {
            const itemsLength = Array.isArray(storedItems)
              ? storedItems.length
              : Object.keys(storedItems).length

            maxIterations = itemsLength
            logger.info(
              `forEach loop ${loopId} - Items: ${itemsLength}, Max iterations: ${maxIterations}`
            )
          } else {
            const itemsLength = this.getItemsLength(loop.forEachItems)
            if (itemsLength > 0) {
              maxIterations = itemsLength
              logger.info(
                `forEach loop ${loopId} - Parsed items: ${itemsLength}, Max iterations: ${maxIterations}`
              )
            }
          }
        }

        logger.info(`Loop ${loopId} - Current: ${currentIteration}, Max: ${maxIterations}`)

        // Check if we've completed all iterations
        // The loop handler increments the counter after setting up each iteration
        // So if currentIteration equals maxIterations, we've completed all iterations
        if (currentIteration >= maxIterations) {
          // This was the last iteration
          hasLoopReachedMaxIterations = true
          logger.info(`Loop ${loopId} has completed all ${maxIterations} iterations`)

          // Aggregate results from all iterations using stored results
          const results = []
          const loopState = context.loopExecutions?.get(loopId)
          if (loopState) {
            for (let i = 0; i < maxIterations; i++) {
              const result = loopState.executionResults.get(`iteration_${i}`)
              if (result) {
                // If result is an array (from multiple blocks in the loop), flatten it
                if (Array.isArray(result)) {
                  results.push(...result)
                } else {
                  results.push(result)
                }
              }
            }
          }

          // Store the aggregated results in the loop block's state so subsequent blocks can reference them
          const aggregatedOutput = {
            loopId,
            currentIteration: maxIterations - 1, // Last iteration index
            maxIterations,
            loopType: loop.loopType || 'for',
            completed: true,
            results,
            message: `Completed all ${maxIterations} iterations`,
          }

          // Store the aggregated results in context so blocks connected to loop-end-source can access them
          context.blockStates.set(loopId, {
            output: aggregatedOutput,
            executed: true,
            executionTime: 0, // Loop coordination doesn't have meaningful execution time
          })

          // Mark this loop as completed
          context.completedLoops.add(loopId)

          // Activate the loop-end-source connections to continue workflow after loop
          const loopEndConnections =
            context.workflow?.connections.filter(
              (conn) => conn.source === loopId && conn.sourceHandle === 'loop-end-source'
            ) || []

          for (const conn of loopEndConnections) {
            context.activeExecutionPath.add(conn.target)
            logger.info(`Activated post-loop path from ${loopId} to ${conn.target}`)
          }

          logger.info(`Loop ${loopId} - Completed and activated end connections`)
        } else {
          // More iterations to go - reset the blocks inside the loop
          this.resetLoopBlocks(loopId, loop, context)

          // Reset the loop block itself so it can execute again
          context.executedBlocks.delete(loopId)
          context.blockStates.delete(loopId)

          logger.info(`Loop ${loopId} - Reset for iteration ${currentIteration}`)
        }
      }
    }

    return hasLoopReachedMaxIterations
  }

  /**
   * Helper to get the length of items for forEach loops
   */
  private getItemsLength(forEachItems: any): number {
    if (Array.isArray(forEachItems)) {
      return forEachItems.length
    }
    if (typeof forEachItems === 'object' && forEachItems !== null) {
      return Object.keys(forEachItems).length
    }
    if (typeof forEachItems === 'string') {
      // Try to parse if it's a JSON string
      try {
        const parsed = JSON.parse(forEachItems)
        if (Array.isArray(parsed)) {
          return parsed.length
        }
        if (typeof parsed === 'object' && parsed !== null) {
          return Object.keys(parsed).length
        }
      } catch {
        // Not valid JSON
      }
    }
    return 0
  }

  /**
   * Resets all blocks within a loop for the next iteration.
   *
   * @param loopId - ID of the loop
   * @param loop - The loop configuration
   * @param context - Current execution context
   */
  private resetLoopBlocks(loopId: string, loop: SerializedLoop, context: ExecutionContext): void {
    logger.info(`Resetting blocks for loop ${loopId}`)

    // Reset all blocks in the loop
    for (const nodeId of loop.nodes) {
      // Remove from executed blocks
      context.executedBlocks.delete(nodeId)

      // Clear the block state
      context.blockStates.delete(nodeId)

      // Remove from active execution path
      context.activeExecutionPath.delete(nodeId)

      // Clear any routing decisions for this block
      context.decisions.router.delete(nodeId)
      context.decisions.condition.delete(nodeId)

      logger.info(`Reset block ${nodeId} in loop ${loopId} for next iteration`)
    }

    logger.info(`After reset - executed blocks: ${Array.from(context.executedBlocks).join(', ')}`)
    logger.info(`After reset - active paths: ${Array.from(context.activeExecutionPath).join(', ')}`)
  }

  /**
   * Stores the result of a loop iteration.
   */
  storeIterationResult(
    context: ExecutionContext,
    loopId: string,
    iterationIndex: number,
    _blockId: string, // Not used anymore since we're storing results directly
    output: any
  ): void {
    if (!context.loopExecutions) {
      context.loopExecutions = new Map()
    }

    let loopState = context.loopExecutions.get(loopId)
    if (!loopState) {
      const loop = this.loops[loopId]
      const loopType = loop?.loopType === 'forEach' ? 'forEach' : 'for'
      const forEachItems = loop?.forEachItems

      loopState = {
        maxIterations: loop?.iterations || this.defaultIterations,
        loopType,
        forEachItems:
          Array.isArray(forEachItems) || (typeof forEachItems === 'object' && forEachItems !== null)
            ? forEachItems
            : null,
        executionResults: new Map(),
        currentIteration: 0,
      }
      context.loopExecutions.set(loopId, loopState)
    }

    // Store the output directly for this iteration
    const iterationKey = `iteration_${iterationIndex}`
    loopState.executionResults.set(iterationKey, output)
  }

  /**
   * Gets the correct loop index based on the current block being executed.
   *
   * @param loopId - ID of the loop
   * @param blockId - ID of the block requesting the index
   * @param context - Current execution context
   * @returns The correct loop index for this block
   */
  getLoopIndex(loopId: string, blockId: string, context: ExecutionContext): number {
    const loop = this.loops[loopId]
    if (!loop) return 0

    // Return the current iteration counter
    return context.loopIterations.get(loopId) || 0
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

  /**
   * Gets the current item for a forEach loop.
   *
   * @param loopId - ID of the loop
   * @param context - Current execution context
   * @returns Current item in the loop iteration
   */
  getCurrentItem(loopId: string, context: ExecutionContext): any {
    return context.loopItems.get(loopId)
  }

  /**
   * Checks if all blocks in a list have been executed.
   * For routing blocks (condition/router), only checks if the selected path has been executed.
   *
   * @param nodeIds - IDs of nodes to check
   * @param context - Current execution context
   * @returns Whether all blocks have been executed
   */
  private allBlocksExecuted(nodeIds: string[], context: ExecutionContext): boolean {
    // Get all connections within the loop
    const loopConnections =
      context.workflow?.connections.filter(
        (conn) => nodeIds.includes(conn.source) && nodeIds.includes(conn.target)
      ) || []

    // Build a map of blocks to their outgoing connections within the loop
    const blockOutgoingConnections = new Map<string, typeof loopConnections>()
    for (const nodeId of nodeIds) {
      blockOutgoingConnections.set(
        nodeId,
        loopConnections.filter((conn) => conn.source === nodeId)
      )
    }

    // Find blocks that have no incoming connections within the loop (entry points)
    const entryBlocks = nodeIds.filter((nodeId) => {
      const hasIncomingFromLoop = loopConnections.some((conn) => conn.target === nodeId)
      return !hasIncomingFromLoop
    })

    // Track which blocks we've visited and determined are reachable
    const reachableBlocks = new Set<string>()
    const toVisit = [...entryBlocks]

    // Traverse the graph to find all reachable blocks
    while (toVisit.length > 0) {
      const currentBlockId = toVisit.shift()!

      // Skip if already visited
      if (reachableBlocks.has(currentBlockId)) continue

      reachableBlocks.add(currentBlockId)

      // Get the block
      const block = context.workflow?.blocks.find((b) => b.id === currentBlockId)
      if (!block) continue

      // Get outgoing connections from this block
      const outgoing = blockOutgoingConnections.get(currentBlockId) || []

      // Handle routing blocks specially
      if (block.metadata?.id === BlockType.ROUTER) {
        // For router blocks, only follow the selected path
        const selectedTarget = context.decisions.router.get(currentBlockId)
        if (selectedTarget && nodeIds.includes(selectedTarget)) {
          toVisit.push(selectedTarget)
        }
      } else if (block.metadata?.id === BlockType.CONDITION) {
        // For condition blocks, only follow the selected condition path
        const selectedConditionId = context.decisions.condition.get(currentBlockId)
        if (selectedConditionId) {
          const selectedConnection = outgoing.find(
            (conn) => conn.sourceHandle === `condition-${selectedConditionId}`
          )
          if (selectedConnection?.target) {
            toVisit.push(selectedConnection.target)
          }
        }
      } else {
        // For regular blocks, use the extracted error handling method
        this.handleErrorConnections(currentBlockId, outgoing, context, toVisit)
      }
    }

    // Now check if all reachable blocks have been executed
    for (const reachableBlockId of reachableBlocks) {
      if (!context.executedBlocks.has(reachableBlockId)) {
        logger.info(
          `Loop iteration not complete - block ${reachableBlockId} is reachable but not executed`
        )
        return false
      }
    }

    logger.info(
      `All reachable blocks in loop have been executed. Reachable: ${Array.from(reachableBlocks).join(', ')}`
    )
    return true
  }

  /**
   * Checks if a connection forms a feedback path in a loop.
   * With loop blocks, feedback paths are now handled by loop-to-inner-block connections.
   *
   * @param connection - Connection to check
   * @param blocks - All blocks in the workflow
   * @returns Whether the connection forms a feedback path
   */
  isFeedbackPath(connection: SerializedConnection, blocks: SerializedBlock[]): boolean {
    // With the new loop block approach, feedback paths are connections from
    // blocks inside the loop back to the loop block itself
    for (const [loopId, loop] of Object.entries(this.loops)) {
      // Use Set for O(1) lookup performance instead of O(n) includes()
      const loopNodesSet = new Set(loop.nodes)

      // Check if source is inside the loop and target is the loop block
      if (loopNodesSet.has(connection.source) && connection.target === loopId) {
        return true
      }
    }

    return false
  }

  /**
   * Handles error connections and follows appropriate paths based on error state.
   *
   * @param blockId - ID of the block to check for error handling
   * @param outgoing - Outgoing connections from the block
   * @param context - Current execution context
   * @param toVisit - Array to add next blocks to visit
   */
  private handleErrorConnections(
    blockId: string,
    outgoing: any[],
    context: ExecutionContext,
    toVisit: string[]
  ): void {
    // For regular blocks, check if they had an error
    const blockState = context.blockStates.get(blockId)
    const hasError = blockState?.output?.error !== undefined

    // Follow appropriate connections based on error state
    for (const conn of outgoing) {
      if (conn.sourceHandle === 'error' && hasError) {
        toVisit.push(conn.target)
      } else if ((conn.sourceHandle === 'source' || !conn.sourceHandle) && !hasError) {
        toVisit.push(conn.target)
      }
    }
  }
}
