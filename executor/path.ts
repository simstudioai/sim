import { SerializedWorkflow } from '@/serializer/types'
import { ExecutionContext } from './types'

/**
 * Manages the active execution paths in the workflow.
 * Tracks which blocks should be executed based on routing decisions.
 */
export class PathTracker {
  constructor(private workflow: SerializedWorkflow) {}

  /**
   * Check if a block is in the active execution path
   */
  isInActivePath(blockId: string, context: ExecutionContext): boolean {
    // If the block is already in the active path set, it's valid
    if (context.activeExecutionPath.has(blockId)) {
      return true
    }

    // If we have router decisions, check them
    for (const [routerId, targetId] of context.decisions.router.entries()) {
      // If this block is the target of a router decision, it's in the path
      if (blockId === targetId) {
        return true
      }

      // If this block is connected to a router but is not the selected target, it's not in the path
      const isConnectedToRouter = this.workflow.connections.some(
        (conn) => conn.source === routerId && conn.target === blockId
      )

      if (isConnectedToRouter && blockId !== targetId) {
        return false
      }
    }

    // If we have condition decisions, check them
    for (const [conditionId, selectedConditionId] of context.decisions.condition.entries()) {
      // Check if this block is connected to the condition block
      const connection = this.workflow.connections.find(
        (conn) =>
          conn.source === conditionId &&
          conn.target === blockId &&
          conn.sourceHandle?.startsWith('condition-')
      )

      if (connection) {
        const conditionSourceId = connection.sourceHandle?.replace('condition-', '')
        // If this is not the selected condition path, block is not in the path
        if (conditionSourceId !== selectedConditionId) {
          return false
        }
        // If this is the selected condition path, block is in the path
        return true
      }
    }

    // If no specific routing decisions affect this block, check normal connectivity
    // A block is in the path if it's connected to an executed block that's in the path
    const incomingConnections = this.workflow.connections.filter((conn) => conn.target === blockId)

    return incomingConnections.some((conn) => {
      const sourceExecuted = context.executedBlocks.has(conn.source)
      const sourceInPath = this.isInActivePath(conn.source, context)
      return sourceExecuted && sourceInPath
    })
  }

  /**
   * Update execution paths based on newly executed blocks
   */
  updateExecutionPaths(executedBlockIds: string[], context: ExecutionContext): void {
    for (const blockId of executedBlockIds) {
      // For router blocks, update target decisions
      const block = this.workflow.blocks.find((b) => b.id === blockId)
      if (block?.metadata?.id === 'router') {
        const routerOutput = context.blockStates.get(blockId)?.output
        const selectedPath = routerOutput?.response?.selectedPath?.blockId

        if (selectedPath) {
          context.decisions.router.set(blockId, selectedPath)
          context.activeExecutionPath.add(selectedPath)

          // Remove other connected blocks from active path
          const connectedBlocks = this.workflow.connections
            .filter((conn) => conn.source === blockId && conn.target !== selectedPath)
            .map((conn) => conn.target)

          for (const connectedId of connectedBlocks) {
            context.activeExecutionPath.delete(connectedId)
          }
        }
      }

      // For condition blocks, update path decisions
      else if (block?.metadata?.id === 'condition') {
        const conditionOutput = context.blockStates.get(blockId)?.output
        const selectedConditionId = conditionOutput?.response?.selectedConditionId

        if (selectedConditionId) {
          context.decisions.condition.set(blockId, selectedConditionId)

          // Find the target block for the selected condition
          const targetConnection = this.workflow.connections.find(
            (conn) =>
              conn.source === blockId && conn.sourceHandle === `condition-${selectedConditionId}`
          )

          if (targetConnection) {
            context.activeExecutionPath.add(targetConnection.target)

            // Remove other connected blocks from active path
            const otherConnections = this.workflow.connections.filter(
              (conn) =>
                conn.source === blockId &&
                conn.sourceHandle?.startsWith('condition-') &&
                conn.sourceHandle !== `condition-${selectedConditionId}`
            )

            for (const conn of otherConnections) {
              context.activeExecutionPath.delete(conn.target)
            }
          }
        }
      }

      // For regular blocks, add outgoing connections to active path
      else {
        const outgoingConnections = this.workflow.connections.filter(
          (conn) => conn.source === blockId
        )

        for (const conn of outgoingConnections) {
          context.activeExecutionPath.add(conn.target)
        }
      }
    }
  }
}
