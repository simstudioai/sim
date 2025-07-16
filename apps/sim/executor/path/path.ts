import { createLogger } from '@/lib/logs/console-logger'
import { BlockType } from '@/executor/consts'
import { Routing } from '@/executor/routing/routing'
import type { BlockState, ExecutionContext } from '@/executor/types'
import type { SerializedBlock, SerializedConnection, SerializedWorkflow } from '@/serializer/types'

const logger = createLogger('PathTracker')

/**
 * Manages the active execution paths in the workflow.
 * Tracks which blocks should be executed based on routing decisions.
 */
export class PathTracker {
  constructor(private workflow: SerializedWorkflow) {}

  /**
   * Checks if a block is in the active execution path.
   * Considers router and condition block decisions.
   *
   * @param blockId - ID of the block to check
   * @param context - Current execution context
   * @returns Whether the block is in the active execution path
   */
  isInActivePath(blockId: string, context: ExecutionContext): boolean {
    // Early return if already in active path
    if (context.activeExecutionPath.has(blockId)) {
      return true
    }

    // Get all incoming connections to this block
    const incomingConnections = this.getIncomingConnections(blockId)

    // A block is in the active path if at least one of its incoming connections
    // is from an active and executed block
    return incomingConnections.some((conn) => this.isConnectionActive(conn, context))
  }

  /**
   * Updates execution paths based on newly executed blocks.
   * Handles router and condition block decisions to activate paths without deactivating others.
   *
   * @param executedBlockIds - IDs of blocks that were just executed
   * @param context - Current execution context
   */
  updateExecutionPaths(executedBlockIds: string[], context: ExecutionContext): void {
    logger.info(`Updating paths for blocks: ${executedBlockIds.join(', ')}`)

    for (const blockId of executedBlockIds) {
      const block = this.getBlock(blockId)
      if (!block) continue

      this.updatePathForBlock(block, context)
    }
  }

  /**
   * Get all incoming connections to a block
   */
  private getIncomingConnections(blockId: string): SerializedConnection[] {
    return this.workflow.connections.filter((conn) => conn.target === blockId)
  }

  /**
   * Get all outgoing connections from a block
   */
  private getOutgoingConnections(blockId: string): SerializedConnection[] {
    return this.workflow.connections.filter((conn) => conn.source === blockId)
  }

  /**
   * Get a block by ID
   */
  private getBlock(blockId: string): SerializedBlock | undefined {
    return this.workflow.blocks.find((b) => b.id === blockId)
  }

  /**
   * Check if a connection is active based on its source block type and state
   */
  private isConnectionActive(connection: SerializedConnection, context: ExecutionContext): boolean {
    const sourceBlock = this.getBlock(connection.source)
    if (!sourceBlock) return false

    const blockType = sourceBlock.metadata?.id || ''
    const category = Routing.getCategory(blockType)

    // Use routing strategy to determine connection checking method
    switch (category) {
      case 'routing':
        return blockType === BlockType.ROUTER
          ? this.isRouterConnectionActive(connection, context)
          : this.isConditionConnectionActive(connection, context)
      default:
        return this.isRegularConnectionActive(connection, context)
    }
  }

  /**
   * Check if a router connection is active
   */
  private isRouterConnectionActive(
    connection: SerializedConnection,
    context: ExecutionContext
  ): boolean {
    const selectedTarget = context.decisions.router.get(connection.source)
    return context.executedBlocks.has(connection.source) && selectedTarget === connection.target
  }

  /**
   * Check if a condition connection is active
   */
  private isConditionConnectionActive(
    connection: SerializedConnection,
    context: ExecutionContext
  ): boolean {
    if (!connection.sourceHandle?.startsWith('condition-')) {
      return false
    }

    const conditionId = connection.sourceHandle.replace('condition-', '')
    const selectedCondition = context.decisions.condition.get(connection.source)

    return context.executedBlocks.has(connection.source) && conditionId === selectedCondition
  }

  /**
   * Check if a regular connection is active
   */
  private isRegularConnectionActive(
    connection: SerializedConnection,
    context: ExecutionContext
  ): boolean {
    return (
      context.activeExecutionPath.has(connection.source) &&
      context.executedBlocks.has(connection.source)
    )
  }

  /**
   * Update paths for a specific block based on its type
   */
  private updatePathForBlock(block: SerializedBlock, context: ExecutionContext): void {
    const blockType = block.metadata?.id || ''
    const category = Routing.getCategory(blockType)

    switch (category) {
      case 'routing':
        if (blockType === BlockType.ROUTER) {
          this.updateRouterPaths(block, context)
        } else {
          this.updateConditionPaths(block, context)
        }
        break
      case 'flow-control':
        if (blockType === BlockType.LOOP) {
          this.updateLoopPaths(block, context)
        } else {
          // For parallel blocks, they're handled by their own handler
          this.updateRegularBlockPaths(block, context)
        }
        break
      default:
        this.updateRegularBlockPaths(block, context)
        break
    }
  }

  /**
   * Update paths for router blocks
   */
  private updateRouterPaths(block: SerializedBlock, context: ExecutionContext): void {
    const routerOutput = context.blockStates.get(block.id)?.output
    const selectedPath = routerOutput?.selectedPath?.blockId

    if (selectedPath) {
      context.decisions.router.set(block.id, selectedPath)
      context.activeExecutionPath.add(selectedPath)

      // Check if the selected target should activate downstream paths
      const selectedBlock = this.getBlock(selectedPath)
      const selectedBlockType = selectedBlock?.metadata?.id || ''
      const selectedCategory = Routing.getCategory(selectedBlockType)

      // Only activate downstream paths for regular blocks
      // Routing blocks make their own routing decisions when they execute
      // Flow control blocks manage their own path activation
      if (selectedCategory === 'regular') {
        this.activateDownstreamPathsSelectively(selectedPath, context)
      }

      logger.info(`Router ${block.id} selected path: ${selectedPath}`)
    }
  }

  /**
   * Selectively activate downstream paths, respecting block routing behavior
   * This prevents flow control blocks from being activated when they should be controlled by routing
   */
  private activateDownstreamPathsSelectively(blockId: string, context: ExecutionContext): void {
    const outgoingConnections = this.getOutgoingConnections(blockId)

    for (const conn of outgoingConnections) {
      if (!context.activeExecutionPath.has(conn.target)) {
        const targetBlock = this.getBlock(conn.target)
        const targetBlockType = targetBlock?.metadata?.id

        // Use routing strategy to determine if this connection should be activated
        if (!Routing.shouldSkipConnection(conn.sourceHandle, targetBlockType || '')) {
          context.activeExecutionPath.add(conn.target)

          // Recursively activate downstream paths if the target block should activate downstream
          if (Routing.shouldActivateDownstream(targetBlockType || '')) {
            this.activateDownstreamPathsSelectively(conn.target, context)
          }
        }
      }
    }
  }

  /**
   * Update paths for condition blocks
   */
  private updateConditionPaths(block: SerializedBlock, context: ExecutionContext): void {
    const conditionOutput = context.blockStates.get(block.id)?.output
    const selectedConditionId = conditionOutput?.selectedConditionId

    if (!selectedConditionId) return

    context.decisions.condition.set(block.id, selectedConditionId)

    const targetConnections = this.workflow.connections.filter(
      (conn) => conn.source === block.id && conn.sourceHandle === `condition-${selectedConditionId}`
    )

    for (const conn of targetConnections) {
      context.activeExecutionPath.add(conn.target)
      logger.debug(`Condition ${block.id} activated path to: ${conn.target}`)
    }
  }

  /**
   * Update paths for loop blocks
   */
  private updateLoopPaths(block: SerializedBlock, context: ExecutionContext): void {
    const outgoingConnections = this.getOutgoingConnections(block.id)

    for (const conn of outgoingConnections) {
      // Only activate loop-start connections
      if (conn.sourceHandle === 'loop-start-source') {
        context.activeExecutionPath.add(conn.target)
        logger.info(`Loop ${block.id} activated start path to: ${conn.target}`)
      }
      // loop-end-source connections will be activated by the loop manager
    }
  }

  /**
   * Update paths for regular blocks
   */
  private updateRegularBlockPaths(block: SerializedBlock, context: ExecutionContext): void {
    const blockState = context.blockStates.get(block.id)
    const hasError = this.blockHasError(blockState)
    const outgoingConnections = this.getOutgoingConnections(block.id)

    // Check if block is part of loops
    const blockLoops = this.getBlockLoops(block.id, context)
    const isPartOfLoop = blockLoops.length > 0

    for (const conn of outgoingConnections) {
      if (this.shouldActivateConnection(conn, hasError, isPartOfLoop, blockLoops, context)) {
        const targetBlock = this.getBlock(conn.target)
        const targetBlockType = targetBlock?.metadata?.id

        // Use routing strategy to determine if this connection should be activated
        if (Routing.shouldSkipConnection(conn.sourceHandle, targetBlockType || '')) {
          continue
        }

        context.activeExecutionPath.add(conn.target)
      }
    }
  }

  /**
   * Check if a block has an error
   */
  private blockHasError(blockState: BlockState | undefined): boolean {
    return blockState?.output?.error !== undefined
  }

  /**
   * Get loops that contain a block
   */
  private getBlockLoops(
    blockId: string,
    context: ExecutionContext
  ): Array<{ id: string; loop: any }> {
    return Object.entries(context.workflow?.loops || {})
      .filter(([_, loop]) => loop.nodes.includes(blockId))
      .map(([id, loop]) => ({ id, loop }))
  }

  /**
   * Determine if a connection should be activated
   */
  private shouldActivateConnection(
    conn: SerializedConnection,
    hasError: boolean,
    isPartOfLoop: boolean,
    blockLoops: Array<{ id: string; loop: any }>,
    context: ExecutionContext
  ): boolean {
    // Check if this is an external loop connection
    if (isPartOfLoop) {
      const isInternalConnection = blockLoops.some(({ loop }) => loop.nodes.includes(conn.target))
      const isExternalConnection = !isInternalConnection
      const allLoopsCompleted = blockLoops.every(({ id }) => context.completedLoops?.has(id))

      // Skip external connections unless all loops are completed
      if (isExternalConnection && !allLoopsCompleted) {
        return false
      }
    }

    // Handle error connections
    if (conn.sourceHandle === 'error') {
      return hasError
    }

    // Handle regular connections
    if (conn.sourceHandle === 'source' || !conn.sourceHandle) {
      return !hasError
    }

    // All other connection types are activated
    return true
  }
}
