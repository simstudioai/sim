import { SerializedWorkflow } from '@/serializer/types'
import { ExecutionContext } from './types'

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
    // If the block is already in the active path set, it's valid
    if (context.activeExecutionPath.has(blockId)) {
      return true
    }

    // Get all incoming connections to this block
    const incomingConnections = this.workflow.connections.filter((conn) => conn.target === blockId)

    // A block is in the active path if at least one of its incoming connections
    // is from an active and executed block
    return incomingConnections.some((conn) => {
      const sourceBlock = this.workflow.blocks.find((b) => b.id === conn.source)

      // For router blocks, check if this is the selected target
      if (sourceBlock?.metadata?.id === 'router') {
        const selectedTarget = context.decisions.router.get(conn.source)
        // This path is active if the router selected this target
        if (context.executedBlocks.has(conn.source) && selectedTarget === blockId) {
          return true
        }
        return false
      }

      // For condition blocks, check if this is the selected condition
      if (sourceBlock?.metadata?.id === 'condition') {
        if (conn.sourceHandle?.startsWith('condition-')) {
          const conditionId = conn.sourceHandle.replace('condition-', '')
          const selectedCondition = context.decisions.condition.get(conn.source)
          // This path is active if the condition selected this path
          if (context.executedBlocks.has(conn.source) && conditionId === selectedCondition) {
            return true
          }
          return false
        }
      }

      // For regular blocks, check if the source is in the active path and executed
      return context.activeExecutionPath.has(conn.source) && context.executedBlocks.has(conn.source)
    })
  }

  /**
   * Updates execution paths based on newly executed blocks.
   * Handles router and condition block decisions to activate or deactivate paths.
   *
   * @param executedBlockIds - IDs of blocks that were just executed
   * @param context - Current execution context
   */
  updateExecutionPaths(executedBlockIds: string[], context: ExecutionContext): void {
    for (const blockId of executedBlockIds) {
      const block = this.workflow.blocks.find((b) => b.id === blockId)
      if (block?.metadata?.id === 'router') {
        const routerOutput = context.blockStates.get(blockId)?.output
        const selectedPath = routerOutput?.response?.selectedPath?.blockId

        if (selectedPath) {
          context.decisions.router.set(blockId, selectedPath)
          context.activeExecutionPath.add(selectedPath)

          const connectedBlocks = this.workflow.connections
            .filter((conn) => conn.source === blockId && conn.target !== selectedPath)
            .map((conn) => conn.target)

          for (const connectedId of connectedBlocks) {
            context.activeExecutionPath.delete(connectedId)
            this.removeDownstreamBlocks(connectedId, context)
          }
        }
      } else if (block?.metadata?.id === 'condition') {
        const conditionOutput = context.blockStates.get(blockId)?.output
        const selectedConditionId = conditionOutput?.response?.selectedConditionId

        if (selectedConditionId) {
          context.decisions.condition.set(blockId, selectedConditionId)

          const targetConnection = this.workflow.connections.find(
            (conn) =>
              conn.source === blockId && conn.sourceHandle === `condition-${selectedConditionId}`
          )

          if (targetConnection) {
            context.activeExecutionPath.add(targetConnection.target)

            const otherConnections = this.workflow.connections.filter(
              (conn) =>
                conn.source === blockId &&
                conn.sourceHandle?.startsWith('condition-') &&
                conn.sourceHandle !== `condition-${selectedConditionId}`
            )

            for (const conn of otherConnections) {
              context.activeExecutionPath.delete(conn.target)
              this.removeDownstreamBlocks(conn.target, context)
            }
          }
        }
      } else {
        const outgoingConnections = this.workflow.connections.filter(
          (conn) => conn.source === blockId
        )

        for (const conn of outgoingConnections) {
          context.activeExecutionPath.add(conn.target)
        }
      }
    }
  }

  /**
   * Recursively removes blocks that are only reachable through inactive paths.
   * Prevents execution of blocks that should be skipped due to routing decisions.
   *
   * @param blockId - ID of the block to start removal from
   * @param context - Current execution context
   */
  private removeDownstreamBlocks(blockId: string, context: ExecutionContext): void {
    const outgoingConnections = this.workflow.connections.filter((conn) => conn.source === blockId)

    for (const conn of outgoingConnections) {
      const targetId = conn.target

      const hasOtherActivePaths = this.workflow.connections.some(
        (otherConn) =>
          otherConn.target === targetId &&
          otherConn.source !== blockId &&
          context.activeExecutionPath.has(otherConn.source)
      )

      if (!hasOtherActivePaths) {
        context.activeExecutionPath.delete(targetId)
        this.removeDownstreamBlocks(targetId, context)
      }
    }
  }
}
