/**
 * EdgeManager
 * 
 * Manages all edge-related operations in the DAG:
 * - Edge activation/deactivation based on block outputs
 * - Incoming edge removal as dependencies complete
 * - Node ready state detection (inDegree = 0)
 * - Edge deactivation propagation for unreachable paths
 * 
 * This is the single source of truth for graph traversal logic.
 */

import { createLogger } from '@/lib/logs/console/logger'
import type { NormalizedBlockOutput } from '@/executor/types'
import type { DAG, DAGNode } from '../dag/builder'
import type { DAGEdge } from '../dag/types'

const logger = createLogger('EdgeManager')

const EDGE_HANDLE = {
  CONDITION_PREFIX: 'condition-',
  ROUTER_PREFIX: 'router-',
  ERROR: 'error',
  SOURCE: 'source',
  LOOP_CONTINUE: 'loop_continue',
  LOOP_CONTINUE_ALT: 'loop-continue-source',
  LOOP_EXIT: 'loop_exit',
  DEFAULT: 'default',
} as const

/**
 * Manages edge activation, deactivation, and node ready state in the DAG
 */
export class EdgeManager {
  private deactivatedEdges = new Set<string>()

  constructor(private dag: DAG) {}

  /**
   * Process outgoing edges from a completed node
   * Removes incoming edges from targets and returns nodes that become ready
   * 
   * @param node - The node that just completed
   * @param output - The output from the node
   * @param skipBackwardsEdge - Whether to skip backward edges (for loops)
   * @returns Array of node IDs that became ready
   */
  processOutgoingEdges(
    node: DAGNode,
    output: NormalizedBlockOutput,
    skipBackwardsEdge: boolean = false
  ): string[] {
    const readyNodes: string[] = []

    logger.debug('Processing outgoing edges', {
      nodeId: node.id,
      edgeCount: node.outgoingEdges.size,
      skipBackwardsEdge,
    })

    for (const [edgeId, edge] of node.outgoingEdges) {
      // Skip backwards edges if requested (for loop continuation)
      if (skipBackwardsEdge && this.isBackwardsEdge(edge.sourceHandle)) {
        logger.debug('Skipping backwards edge', { edgeId })
        continue
      }

      // Determine if this edge should activate based on output
      const shouldActivate = this.shouldActivateEdge(edge, output)

      if (!shouldActivate) {
        // For loop edges, don't deactivate descendants (edges are reusable)
        const isLoopEdge =
          edge.sourceHandle === EDGE_HANDLE.LOOP_CONTINUE ||
          edge.sourceHandle === EDGE_HANDLE.LOOP_CONTINUE_ALT ||
          edge.sourceHandle === EDGE_HANDLE.LOOP_EXIT

        if (!isLoopEdge) {
          this.deactivateEdgeAndDescendants(node.id, edge.target, edge.sourceHandle)
        }

        logger.debug('Edge not activated', {
          edgeId,
          sourceHandle: edge.sourceHandle,
          from: node.id,
          to: edge.target,
          isLoopEdge,
          deactivatedDescendants: !isLoopEdge,
        })
        continue
      }

      // Edge is activated - remove from target's incoming edges
      const targetNode = this.dag.nodes.get(edge.target)
      if (!targetNode) {
        logger.warn('Target node not found', { target: edge.target })
        continue
      }

      targetNode.incomingEdges.delete(node.id)

      logger.debug('Removed incoming edge', {
        from: node.id,
        target: edge.target,
        remainingIncomingEdges: targetNode.incomingEdges.size,
      })

      // Check if target node is now ready
      if (this.isNodeReady(targetNode)) {
        logger.debug('Node ready', { nodeId: targetNode.id })
        readyNodes.push(targetNode.id)
      }
    }

    return readyNodes
  }

  /**
   * Check if a node is ready to execute
   * A node is ready when it has no active incoming edges
   */
  isNodeReady(node: DAGNode): boolean {
    if (node.incomingEdges.size === 0) {
      return true
    }

    const activeIncomingCount = this.countActiveIncomingEdges(node)

    if (activeIncomingCount > 0) {
      logger.debug('Node not ready - waiting for active incoming edges', {
        nodeId: node.id,
        totalIncoming: node.incomingEdges.size,
        activeIncoming: activeIncomingCount,
      })
      return false
    }

    logger.debug('Node ready - all remaining edges are deactivated', {
      nodeId: node.id,
      totalIncoming: node.incomingEdges.size,
    })
    return true
  }

  /**
   * Restore incoming edges for a node
   * Used by loop continuation to reset edges for next iteration
   */
  restoreIncomingEdge(targetNodeId: string, sourceNodeId: string): void {
    const targetNode = this.dag.nodes.get(targetNodeId)
    if (!targetNode) {
      logger.warn('Cannot restore edge - target node not found', { targetNodeId })
      return
    }

    targetNode.incomingEdges.add(sourceNodeId)
    logger.debug('Restored incoming edge', {
      from: sourceNodeId,
      to: targetNodeId,
    })
  }

  /**
   * Clear deactivated edges tracking
   * Used when restarting execution or clearing state
   */
  clearDeactivatedEdges(): void {
    this.deactivatedEdges.clear()
  }

  /**
   * PRIVATE METHODS
   */

  /**
   * Determine if an edge should activate based on block output
   * Handles condition, router, loop, and error edges
   */
  private shouldActivateEdge(edge: DAGEdge, output: NormalizedBlockOutput): boolean {
    const handle = edge.sourceHandle

    // Condition edges: Check selectedOption
    if (handle?.startsWith(EDGE_HANDLE.CONDITION_PREFIX)) {
      const conditionValue = handle.substring(EDGE_HANDLE.CONDITION_PREFIX.length)
      return output.selectedOption === conditionValue
    }

    // Router edges: Check selectedRoute
    if (handle?.startsWith(EDGE_HANDLE.ROUTER_PREFIX)) {
      const routeId = handle.substring(EDGE_HANDLE.ROUTER_PREFIX.length)
      return output.selectedRoute === routeId
    }

    // Loop continuation edges from sentinel_end
    if (handle === EDGE_HANDLE.LOOP_CONTINUE || handle === EDGE_HANDLE.LOOP_CONTINUE_ALT) {
      return output.selectedRoute === 'loop_continue'
    }

    // Loop exit edges from sentinel_end
    if (handle === EDGE_HANDLE.LOOP_EXIT) {
      return output.selectedRoute === 'loop_exit'
    }

    // Error edges: Only activate if there's an error
    if (handle === EDGE_HANDLE.ERROR && !output.error) {
      return false
    }

    // Source edges: Don't activate if there's an error
    if (handle === EDGE_HANDLE.SOURCE && output.error) {
      return false
    }

    // Default: Activate the edge
    return true
  }

  /**
   * Check if an edge is a backward edge (for loops)
   */
  private isBackwardsEdge(sourceHandle?: string): boolean {
    return (
      sourceHandle === EDGE_HANDLE.LOOP_CONTINUE ||
      sourceHandle === EDGE_HANDLE.LOOP_CONTINUE_ALT
    )
  }

  /**
   * Deactivate an edge and recursively deactivate all descendant paths
   * This ensures unreachable paths don't execute
   */
  private deactivateEdgeAndDescendants(
    sourceId: string,
    targetId: string,
    sourceHandle?: string
  ): void {
    const edgeKey = this.createEdgeKey(sourceId, targetId, sourceHandle)
    
    // Already deactivated - skip
    if (this.deactivatedEdges.has(edgeKey)) {
      return
    }
    
    this.deactivatedEdges.add(edgeKey)

    const targetNode = this.dag.nodes.get(targetId)
    if (!targetNode) return

    // Check if target has other active incoming edges
    const hasOtherActiveIncoming = this.hasActiveIncomingEdges(targetNode, sourceId)

    // If no other active incoming edges, deactivate all descendants
    if (!hasOtherActiveIncoming) {
      logger.debug('Deactivating descendants of unreachable node', { nodeId: targetId })
      
      for (const [_, outgoingEdge] of targetNode.outgoingEdges) {
        this.deactivateEdgeAndDescendants(targetId, outgoingEdge.target, outgoingEdge.sourceHandle)
      }
    }
  }

  /**
   * Check if a node has other active incoming edges (excluding one source)
   */
  private hasActiveIncomingEdges(node: DAGNode, excludeSourceId: string): boolean {
    for (const incomingSourceId of node.incomingEdges) {
      if (incomingSourceId === excludeSourceId) continue

      const incomingNode = this.dag.nodes.get(incomingSourceId)
      if (!incomingNode) continue

      for (const [_, incomingEdge] of incomingNode.outgoingEdges) {
        if (incomingEdge.target === node.id) {
          const incomingEdgeKey = this.createEdgeKey(
            incomingSourceId,
            node.id,
            incomingEdge.sourceHandle
          )
          
          if (!this.deactivatedEdges.has(incomingEdgeKey)) {
            return true
          }
        }
      }
    }
    
    return false
  }

  /**
   * Count active incoming edges for a node
   */
  private countActiveIncomingEdges(node: DAGNode): number {
    let count = 0

    for (const sourceId of node.incomingEdges) {
      const sourceNode = this.dag.nodes.get(sourceId)
      if (!sourceNode) continue

      for (const [_, edge] of sourceNode.outgoingEdges) {
        if (edge.target === node.id) {
          const edgeKey = this.createEdgeKey(sourceId, edge.target, edge.sourceHandle)
          
          if (!this.deactivatedEdges.has(edgeKey)) {
            count++
            break // Only count once per source node
          }
        }
      }
    }

    return count
  }

  /**
   * Create a unique key for an edge
   */
  private createEdgeKey(sourceId: string, targetId: string, sourceHandle?: string): string {
    return `${sourceId}-${targetId}-${sourceHandle || EDGE_HANDLE.DEFAULT}`
  }
}

