import { createLogger } from '@/lib/logs/console-logger'
import type { SerializedBlock, SerializedConnection, SerializedLoop } from '@/serializer/types'
import type { ExecutionContext } from './types'

const logger = createLogger('LoopManager')

/**
 * Manages loop detection, iteration limits, and state resets.
 */
export class LoopManager {
  constructor(
    private loops: Record<string, SerializedLoop>,
    private defaultIterations = 5
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
      // Get the loop type (default to 'for')
      const loopType = loop.loopType || 'for'
      const currentIteration = context.loopIterations.get(loopId) || 0

      // Handle forEach loop
      if (loopType === 'forEach') {
        // Get the items to iterate over if we haven't already processed them into an array/object
        if (
          !loop.forEachItems ||
          typeof loop.forEachItems === 'string' ||
          !(Array.isArray(loop.forEachItems) || typeof loop.forEachItems === 'object')
        ) {
          // Evaluate the forEach items expression
          const items = await this.evalForEachItems(loopId, loop, context)

          // Store the evaluated items for future iterations
          if (Array.isArray(items) || (typeof items === 'object' && items !== null)) {
            loop.forEachItems = items
          } else {
            // Default to empty array if we couldn't get any valid items
            loop.forEachItems = []
          }
        }

        // For forEach, convert to array if it's an object
        const items = Array.isArray(loop.forEachItems)
          ? loop.forEachItems
          : Object.entries(loop.forEachItems as Record<string, any>)

        // If we've processed all items or hit max iterations, mark loop as completed
        if (currentIteration >= items.length || currentIteration >= loop.iterations) {
          if (currentIteration >= items.length) {
            hasLoopReachedMaxIterations = true
          } else {
            hasLoopReachedMaxIterations = true
          }

          // Now that the loop is complete, activate only external paths
          this.activateExternalPaths(loopId, loop, context)
          continue
        }

        // Check if all blocks in the loop have been executed
        const allExecuted = this.allBlocksExecuted(loop.nodes, context)

        if (allExecuted) {
          // Get current item to process in this iteration
          const currentItem = items[currentIteration]

          // Store the current item in the context for blocks to access via <loop.currentItem>
          context.loopItems.set(loopId, currentItem)

          // IMPORTANT: We're incrementing the iteration counter AFTER storing the current item
          // But BEFORE resetting the blocks for next iteration
          // This ensures that when blocks execute in the new iteration, they'll get the correct index
          context.loopIterations.set(loopId, currentIteration + 1)

          // Check if we've now reached iterations limit after incrementing
          if (currentIteration + 1 >= items.length || currentIteration + 1 >= loop.iterations) {
            hasLoopReachedMaxIterations = true

            // IMPORTANT: If we've completed all iterations, activate the external paths
            // This is different from the previous approach - we activate external paths
            // at the end of the last iteration
            this.activateExternalPaths(loopId, loop, context)
          } else {
            // We have more iterations to go, reset the blocks
            // Reset ALL blocks in the loop for the next iteration
            for (const nodeId of loop.nodes) {
              // Remove from executed blocks
              context.executedBlocks.delete(nodeId)

              // Make sure it's in the active execution path
              context.activeExecutionPath.add(nodeId)
            }

            // Make sure the first block in the loop is marked as executable
            const entryBlock = this.findEntryBlock(loop.nodes, context)
            if (loop.nodes.length > 0 && entryBlock) {
              context.activeExecutionPath.add(entryBlock)
            }
          }
        } else {
          // Not all blocks in the loop have been executed yet
          // We need to activate the next block(s) in the loop sequence
          this.activateNextBlocksInLoop(loopId, loop, context)
        }
      } else {
        // Original logic for 'for' loops
        // Get current iteration count
        const currentIteration = context.loopIterations.get(loopId) || 0

        // If we've hit the iterations count, skip this loop and mark flag
        if (currentIteration >= loop.iterations) {
          hasLoopReachedMaxIterations = true

          // Activate external paths from loop blocks when the loop is completed
          this.activateExternalPaths(loopId, loop, context)
          continue
        }

        // Check if all blocks in the loop have been executed
        const allExecuted = this.allBlocksExecuted(loop.nodes, context)

        if (allExecuted) {
          // IMPORTANT: Increment the counter BEFORE resetting blocks for the next iteration
          // This ensures the next iteration will show the correct index value
          context.loopIterations.set(loopId, currentIteration + 1)

          // Check if we've now reached iterations limit after incrementing
          if (currentIteration + 1 >= loop.iterations) {
            hasLoopReachedMaxIterations = true

            // IMPORTANT: If we've completed all iterations, activate the external paths
            // This is different from the previous approach - we activate external paths
            // at the end of the last iteration
            this.activateExternalPaths(loopId, loop, context)
          } else {
            // Reset ALL blocks in the loop, not just blocks after the entry
            for (const nodeId of loop.nodes) {
              // Remove from executed blocks
              context.executedBlocks.delete(nodeId)

              // Make sure it's in the active execution path
              context.activeExecutionPath.add(nodeId)
            }

            // Important: Make sure the first block in the loop is marked as executable
            const entryBlock = this.findEntryBlock(loop.nodes, context)
            if (loop.nodes.length > 0 && entryBlock) {
              // Make sure it's in the active path
              context.activeExecutionPath.add(entryBlock)
            }
          }
        } else {
          // Not all blocks in the loop have been executed yet
          // We need to activate the next block(s) in the loop sequence
          this.activateNextBlocksInLoop(loopId, loop, context)
        }
      }
    }

    return hasLoopReachedMaxIterations
  }

  /**
   * Activates only paths that go from loop nodes to nodes outside the loop.
   * This is called when a loop completes all iterations.
   *
   * @param loopId - ID of the loop
   * @param loop - The loop configuration
   * @param context - Current execution context
   */
  private activateExternalPaths(
    loopId: string,
    loop: SerializedLoop,
    context: ExecutionContext
  ): void {
    if (!context.workflow) return

    // Mark this loop as completed
    if (!context.completedLoops) {
      context.completedLoops = new Set<string>()
    }
    context.completedLoops.add(loopId)

    // First, identify all paths that lead to outside the loop
    // We need to ensure only these are activated on loop completion
    const externalTargets = new Set<string>()

    // Build a map of outgoing connections from each node in the loop
    for (const nodeId of loop.nodes) {
      // Get all outgoing connections from this node
      const outgoingConnections = context.workflow.connections.filter(
        (conn) => conn.source === nodeId
      )

      // For each outgoing connection, check if it leads outside the loop
      for (const conn of outgoingConnections) {
        // If target is not in the loop, it's an external path
        if (!loop.nodes.includes(conn.target)) {
          externalTargets.add(conn.target)
        }
      }
    }

    // Now, only activate the identified external targets
    for (const target of externalTargets) {
      // Find all connections leading to this target from nodes in the loop
      const incomingConnections = context.workflow.connections.filter(
        (conn) => loop.nodes.includes(conn.source) && conn.target === target
      )

      for (const conn of incomingConnections) {
        const sourceBlockId = conn.source
        const blockState = context.blockStates.get(sourceBlockId)
        const hasError =
          blockState?.output?.error !== undefined ||
          blockState?.output?.response?.error !== undefined

        // Apply connection type rules, but only activate for the final iteration
        if (conn.sourceHandle === 'error') {
          // Only activate error paths if there was an error
          if (hasError) {
            context.activeExecutionPath.add(target)
          }
        } else if (conn.sourceHandle === 'source' || !conn.sourceHandle) {
          // Only activate regular paths if there was no error
          if (!hasError) {
            context.activeExecutionPath.add(target)
          }
        } else if (conn.sourceHandle?.startsWith('condition-')) {
          // For condition connections, check if this was the selected condition
          const conditionId = conn.sourceHandle.replace('condition-', '')
          const selectedCondition = context.decisions.condition.get(sourceBlockId)

          if (conditionId === selectedCondition) {
            context.activeExecutionPath.add(target)
          }
        } else if (sourceBlockId === conn.source) {
          // For router blocks, check if this was the selected target
          const sourceBlock = context.workflow.blocks.find((b) => b.id === sourceBlockId)
          if (sourceBlock?.metadata?.id === 'router') {
            const selectedTarget = context.decisions.router.get(sourceBlockId)

            if (selectedTarget === target) {
              context.activeExecutionPath.add(target)
            }
          } else {
            // For any other connection type
            context.activeExecutionPath.add(target)
          }
        }
      }
    }
  }

  /**
   * Gets the correct loop index based on the current block being executed.
   * Accounts for position within the loop cycle to provide accurate index.
   *
   * @param loopId - ID of the loop
   * @param blockId - ID of the block requesting the index
   * @param context - Current execution context
   * @returns The correct loop index for this block
   */
  getLoopIndex(loopId: string, blockId: string, context: ExecutionContext): number {
    const loop = this.loops[loopId]
    if (!loop) return 0

    // Get the current iteration counter from context
    const iterationCounter = context.loopIterations.get(loopId) || 0

    // Simply return the current iteration counter
    // Since we're updating the iteration counter BEFORE resetting blocks,
    // the counter will already be at the correct value for the current iteration
    return iterationCounter
  }

  /**
   * Evaluates the forEach items string or retrieves items for a forEach loop.
   *
   * @param loopId - ID of the loop
   * @param loop - Loop configuration
   * @param context - Current execution context
   * @returns Items to iterate over (array or object)
   */
  private async evalForEachItems(
    loopId: string,
    loop: SerializedLoop,
    context: ExecutionContext
  ): Promise<any[] | Record<string, any> | undefined> {
    // If forEachItems is not set, return empty array
    if (!loop.forEachItems) {
      return []
    }

    // If we already have items as an array or object, return them directly
    if (
      Array.isArray(loop.forEachItems) ||
      (typeof loop.forEachItems === 'object' && loop.forEachItems !== null)
    ) {
      return loop.forEachItems as any[] | Record<string, any>
    }

    // If we have forEachItems as a string, try to evaluate it as an expression
    if (typeof loop.forEachItems === 'string') {
      try {
        // Skip comments or empty expressions
        const trimmedExpression = loop.forEachItems.trim()
        if (trimmedExpression.startsWith('//') || trimmedExpression === '') {
          return []
        }

        // First check if it's valid JSON (array or object)
        if (trimmedExpression.startsWith('[') || trimmedExpression.startsWith('{')) {
          try {
            // Try to parse as JSON first
            // Handle both JSON format (double quotes) and JS format (single quotes)
            const normalizedExpression = trimmedExpression
              .replace(/'/g, '"') // Replace all single quotes with double quotes
              .replace(/(\w+):/g, '"$1":') // Convert property names to double-quoted strings
              .replace(/,\s*]/g, ']') // Remove trailing commas before closing brackets
              .replace(/,\s*}/g, '}') // Remove trailing commas before closing braces

            return JSON.parse(normalizedExpression)
          } catch (jsonError) {
            logger.debug(`Error parsing JSON for loop ${loopId}:`, jsonError)
            // If JSON parsing fails, continue with expression evaluation
          }
        }

        // If not valid JSON or JSON parsing failed, try to evaluate as an expression
        const result = new Function('context', `return ${loop.forEachItems}`)(context)

        // If the result is an array or object, return it
        if (Array.isArray(result) || (typeof result === 'object' && result !== null)) {
          return result
        }

        // If it's a primitive, wrap it in an array
        if (result !== undefined) {
          return [result]
        }

        return []
      } catch (e) {
        logger.error(`Error evaluating forEach items for loop ${loopId}:`, e)
        return []
      }
    }

    // As a fallback, try to find the first non-empty array or object in the context
    for (const [_blockId, blockState] of context.blockStates.entries()) {
      const output = blockState.output?.response
      if (output) {
        // Look for arrays or objects in the response that could be iterated over
        for (const [_key, value] of Object.entries(output)) {
          if (Array.isArray(value) && value.length > 0) {
            return value
          }
          if (typeof value === 'object' && value !== null && Object.keys(value).length > 0) {
            return value
          }
        }
      }
    }

    return []
  }

  /**
   * Finds the entry block for a loop (the one that should be executed first).
   * Typically the block with incoming connections from outside the loop.
   *
   * @param nodeIds - IDs of nodes in the loop
   * @param context - Current execution context
   * @returns ID of the entry block
   */
  private findEntryBlock(nodeIds: string[], context: ExecutionContext): string | undefined {
    // If there's only one node in the loop, it's the entry block
    if (nodeIds.length === 1) {
      return nodeIds[0]
    }

    // Check which blocks have connections from outside the loop
    const blocksWithExternalConnections = new Map<
      string,
      {
        incomingExternal: number
        outgoingExternal: number
        incomingInternal: number
      }
    >()

    for (const nodeId of nodeIds) {
      // Count connections coming from outside the loop
      const externalIncomingCount = context.workflow?.connections.filter(
        (conn) => conn.target === nodeId && !nodeIds.includes(conn.source)
      ).length

      // Count connections going to outside the loop
      const externalOutgoingCount = context.workflow?.connections.filter(
        (conn) => conn.source === nodeId && !nodeIds.includes(conn.target)
      ).length

      // Count internal incoming connections that aren't self-connections
      const internalIncomingCount = context.workflow?.connections.filter(
        (conn) => conn.target === nodeId && conn.source !== nodeId && nodeIds.includes(conn.source)
      ).length

      blocksWithExternalConnections.set(nodeId, {
        incomingExternal: externalIncomingCount || 0,
        outgoingExternal: externalOutgoingCount || 0,
        incomingInternal: internalIncomingCount || 0,
      })
    }

    // First priority: blocks with incoming connections from outside the loop
    const blocksWithExternalIncoming = nodeIds.filter(
      (id) => blocksWithExternalConnections.get(id)?.incomingExternal! > 0
    )

    if (blocksWithExternalIncoming.length > 0) {
      // If multiple blocks have external incoming connections,
      // prioritize the one with the most external incoming connections
      return blocksWithExternalIncoming.sort(
        (a, b) =>
          blocksWithExternalConnections.get(b)?.incomingExternal! -
          blocksWithExternalConnections.get(a)?.incomingExternal!
      )[0]
    }

    // Second priority: look for the likely first node in a self-contained loop
    // This is often the node that has the fewest internal incoming connections
    // but might have outgoing connections to outside the loop

    // Sort blocks by fewest internal incoming connections
    const sortedByInternalIncoming = [...nodeIds].sort(
      (a, b) =>
        (blocksWithExternalConnections.get(a)?.incomingInternal || 0) -
        (blocksWithExternalConnections.get(b)?.incomingInternal || 0)
    )

    // Among those with the fewest internal incoming connections,
    // prioritize those with external outgoing connections
    const candidatesWithFewestIncoming = sortedByInternalIncoming.filter(
      (id) =>
        blocksWithExternalConnections.get(id)?.incomingInternal ===
        blocksWithExternalConnections.get(sortedByInternalIncoming[0])?.incomingInternal
    )

    if (candidatesWithFewestIncoming.length > 1) {
      // Among these candidates, prioritize those with external outgoing connections
      const withExternalOutgoing = candidatesWithFewestIncoming.filter(
        (id) => blocksWithExternalConnections.get(id)?.outgoingExternal! > 0
      )

      if (withExternalOutgoing.length > 0) {
        return withExternalOutgoing[0]
      }
    }

    // If no better criteria found, return the first node with fewest internal incoming connections
    return sortedByInternalIncoming[0]
  }

  /**
   * Checks if all blocks in a list have been executed.
   *
   * @param nodeIds - IDs of nodes to check
   * @param context - Current execution context
   * @returns Whether all blocks have been executed
   */
  private allBlocksExecuted(nodeIds: string[], context: ExecutionContext): boolean {
    // For single-node loops, ensure the node has been executed at least once
    if (nodeIds.length === 1 && context.executedBlocks.has(nodeIds[0])) {
      return true
    }

    // For multi-node loops, ensure all nodes have been executed
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
    // Self-loops are always feedback paths
    if (connection.source === connection.target) {
      return true
    }

    for (const [_loopId, loop] of Object.entries(this.loops)) {
      if (loop.nodes.includes(connection.source) && loop.nodes.includes(connection.target)) {
        // For single-node loops, any connection to itself is a feedback path
        if (
          loop.nodes.length === 1 &&
          loop.nodes[0] === connection.source &&
          connection.source === connection.target
        ) {
          return true
        }

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
   * Activates the next blocks in the loop sequence when not all blocks have been executed.
   * This ensures proper flow through the loop when PathTracker is prevented from activating within-loop paths.
   *
   * @param loopId - ID of the loop
   * @param loop - The loop configuration
   * @param context - Current execution context
   */
  private activateNextBlocksInLoop(
    loopId: string,
    loop: SerializedLoop,
    context: ExecutionContext
  ): void {
    if (!context.workflow) return

    // Find which blocks in the loop have been executed
    const executedLoopBlocks = new Set(
      loop.nodes.filter((nodeId) => context.executedBlocks.has(nodeId))
    )

    if (executedLoopBlocks.size === 0) {
      // If no blocks have been executed yet, activate the entry block
      const entryBlock = this.findEntryBlock(loop.nodes, context)
      if (entryBlock) {
        context.activeExecutionPath.add(entryBlock)
      }
      return
    }

    // For each executed block, find and activate its next blocks in the loop
    for (const executedBlockId of executedLoopBlocks) {
      // Get outgoing connections from this block to other blocks in the loop
      const outgoingConnections = context.workflow.connections.filter(
        (conn) =>
          conn.source === executedBlockId &&
          loop.nodes.includes(conn.target) &&
          !executedLoopBlocks.has(conn.target)
      )

      // Activate each target that hasn't been executed yet
      for (const conn of outgoingConnections) {
        // Skip error connections unless there was an error
        if (conn.sourceHandle === 'error') {
          const blockState = context.blockStates.get(executedBlockId)
          const hasError =
            blockState?.output?.error !== undefined ||
            blockState?.output?.response?.error !== undefined

          if (!hasError) continue
        }

        context.activeExecutionPath.add(conn.target)
      }
    }
  }
}
