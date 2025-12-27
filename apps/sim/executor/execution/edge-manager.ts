import { createLogger } from '@sim/logger'
import { EDGE } from '@/executor/constants'
import type { DAG, DAGNode } from '@/executor/dag/builder'
import type { DAGEdge } from '@/executor/dag/types'
import type { NormalizedBlockOutput } from '@/executor/types'

const logger = createLogger('EdgeManager')

export class EdgeManager {
  private deactivatedEdges = new Set<string>()

  constructor(private dag: DAG) {}

  processOutgoingEdges(
    node: DAGNode,
    output: NormalizedBlockOutput,
    skipBackwardsEdge = false
  ): string[] {
    const readyNodes: string[] = []
    const activatedTargets: string[] = []
    const edgesToDeactivate: Array<{ target: string; handle?: string }> = []

    // First pass: categorize edges as activating or deactivating
    // Don't modify incomingEdges yet - we need the original state for deactivation checks
    for (const [edgeId, edge] of node.outgoingEdges) {
      if (skipBackwardsEdge && this.isBackwardsEdge(edge.sourceHandle)) {
        continue
      }

      const shouldActivate = this.shouldActivateEdge(edge, output)
      if (!shouldActivate) {
        const isLoopEdge =
          edge.sourceHandle === EDGE.LOOP_CONTINUE ||
          edge.sourceHandle === EDGE.LOOP_CONTINUE_ALT ||
          edge.sourceHandle === EDGE.LOOP_EXIT

        if (!isLoopEdge) {
          edgesToDeactivate.push({ target: edge.target, handle: edge.sourceHandle })
        }
        continue
      }

      activatedTargets.push(edge.target)
    }

    // Second pass: process deactivations while incomingEdges is still intact
    // This ensures hasActiveIncomingEdges can find all potential sources
    for (const { target, handle } of edgesToDeactivate) {
      this.deactivateEdgeAndDescendants(node.id, target, handle)
    }

    // Third pass: update incomingEdges for activated targets
    for (const targetId of activatedTargets) {
      const targetNode = this.dag.nodes.get(targetId)
      if (!targetNode) {
        logger.warn('Target node not found', { target: targetId })
        continue
      }
      targetNode.incomingEdges.delete(node.id)
    }

    // Fourth pass: check readiness after all edge processing is complete
    for (const targetId of activatedTargets) {
      const targetNode = this.dag.nodes.get(targetId)
      if (targetNode && this.isNodeReady(targetNode)) {
        readyNodes.push(targetId)
      }
    }

    return readyNodes
  }

  isNodeReady(node: DAGNode): boolean {
    if (node.incomingEdges.size === 0) {
      return true
    }

    const activeIncomingCount = this.countActiveIncomingEdges(node)
    if (activeIncomingCount > 0) {
      return false
    }

    return true
  }

  restoreIncomingEdge(targetNodeId: string, sourceNodeId: string): void {
    const targetNode = this.dag.nodes.get(targetNodeId)
    if (!targetNode) {
      logger.warn('Cannot restore edge - target node not found', { targetNodeId })
      return
    }

    targetNode.incomingEdges.add(sourceNodeId)
  }

  clearDeactivatedEdges(): void {
    this.deactivatedEdges.clear()
  }

  /**
   * Clear deactivated edges for a set of nodes (used when restoring loop state for next iteration).
   * This ensures error/success edges can be re-evaluated on each iteration.
   */
  clearDeactivatedEdgesForNodes(nodeIds: Set<string>): void {
    const edgesToRemove: string[] = []
    for (const edgeKey of this.deactivatedEdges) {
      // Edge key format is "sourceId-targetId-handle"
      // Check if either source or target is in the nodeIds set
      for (const nodeId of nodeIds) {
        if (edgeKey.startsWith(`${nodeId}-`) || edgeKey.includes(`-${nodeId}-`)) {
          edgesToRemove.push(edgeKey)
          break
        }
      }
    }
    for (const edgeKey of edgesToRemove) {
      this.deactivatedEdges.delete(edgeKey)
    }
  }

  private shouldActivateEdge(edge: DAGEdge, output: NormalizedBlockOutput): boolean {
    const handle = edge.sourceHandle

    if (output.selectedRoute === EDGE.LOOP_EXIT) {
      return handle === EDGE.LOOP_EXIT
    }

    if (output.selectedRoute === EDGE.LOOP_CONTINUE) {
      return handle === EDGE.LOOP_CONTINUE || handle === EDGE.LOOP_CONTINUE_ALT
    }

    if (output.selectedRoute === EDGE.PARALLEL_EXIT) {
      return handle === EDGE.PARALLEL_EXIT
    }

    if (!handle) {
      return true
    }

    if (handle.startsWith(EDGE.CONDITION_PREFIX)) {
      const conditionValue = handle.substring(EDGE.CONDITION_PREFIX.length)
      return output.selectedOption === conditionValue
    }

    if (handle.startsWith(EDGE.ROUTER_PREFIX)) {
      const routeId = handle.substring(EDGE.ROUTER_PREFIX.length)
      return output.selectedRoute === routeId
    }

    switch (handle) {
      case EDGE.ERROR:
        return !!output.error

      case EDGE.SOURCE:
        return !output.error

      default:
        return true
    }
  }

  private isBackwardsEdge(sourceHandle?: string): boolean {
    return sourceHandle === EDGE.LOOP_CONTINUE || sourceHandle === EDGE.LOOP_CONTINUE_ALT
  }

  private deactivateEdgeAndDescendants(
    sourceId: string,
    targetId: string,
    sourceHandle?: string
  ): void {
    const edgeKey = this.createEdgeKey(sourceId, targetId, sourceHandle)
    if (this.deactivatedEdges.has(edgeKey)) {
      return
    }

    this.deactivatedEdges.add(edgeKey)
    const targetNode = this.dag.nodes.get(targetId)
    if (!targetNode) return

    // Check if target has other active incoming edges
    // Pass the specific edge key being deactivated, not just source ID,
    // to handle multiple edges from same source to same target (e.g., condition branches)
    const hasOtherActiveIncoming = this.hasActiveIncomingEdges(targetNode, edgeKey)
    if (!hasOtherActiveIncoming) {
      for (const [_, outgoingEdge] of targetNode.outgoingEdges) {
        this.deactivateEdgeAndDescendants(targetId, outgoingEdge.target, outgoingEdge.sourceHandle)
      }
    }
  }

  /**
   * Checks if a node has any active incoming edges besides the one being excluded.
   * This properly handles the case where multiple edges from the same source go to
   * the same target (e.g., multiple condition branches pointing to one block).
   */
  private hasActiveIncomingEdges(node: DAGNode, excludeEdgeKey: string): boolean {
    for (const incomingSourceId of node.incomingEdges) {
      const incomingNode = this.dag.nodes.get(incomingSourceId)
      if (!incomingNode) continue

      for (const [_, incomingEdge] of incomingNode.outgoingEdges) {
        if (incomingEdge.target === node.id) {
          const incomingEdgeKey = this.createEdgeKey(
            incomingSourceId,
            node.id,
            incomingEdge.sourceHandle
          )
          // Skip the specific edge being excluded, but check other edges from same source
          if (incomingEdgeKey === excludeEdgeKey) continue
          if (!this.deactivatedEdges.has(incomingEdgeKey)) {
            return true
          }
        }
      }
    }

    return false
  }

  private countActiveIncomingEdges(node: DAGNode): number {
    let count = 0

    for (const sourceId of node.incomingEdges) {
      const sourceNode = this.dag.nodes.get(sourceId)
      if (!sourceNode) continue

      for (const [, edge] of sourceNode.outgoingEdges) {
        if (edge.target === node.id) {
          const edgeKey = this.createEdgeKey(sourceId, edge.target, edge.sourceHandle)
          if (!this.deactivatedEdges.has(edgeKey)) {
            count++
            break
          }
        }
      }
    }

    return count
  }

  private createEdgeKey(sourceId: string, targetId: string, sourceHandle?: string): string {
    return `${sourceId}-${targetId}-${sourceHandle ?? EDGE.DEFAULT}`
  }
}
