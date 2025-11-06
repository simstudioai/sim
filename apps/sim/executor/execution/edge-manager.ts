import { createLogger } from '@/lib/logs/console/logger'
import { EDGE } from '@/executor/consts'
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
          this.deactivateEdgeAndDescendants(node.id, edge.target, edge.sourceHandle)
        }

        continue
      }

      const targetNode = this.dag.nodes.get(edge.target)
      if (!targetNode) {
        logger.warn('Target node not found', { target: edge.target })
        continue
      }

      targetNode.incomingEdges.delete(node.id)

      if (this.isNodeReady(targetNode)) {
        readyNodes.push(targetNode.id)
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

  private shouldActivateEdge(edge: DAGEdge, output: NormalizedBlockOutput): boolean {
    const handle = edge.sourceHandle

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
      case EDGE.LOOP_CONTINUE:
      case EDGE.LOOP_CONTINUE_ALT:
        return output.selectedRoute === EDGE.LOOP_CONTINUE

      case EDGE.LOOP_EXIT:
        return output.selectedRoute === EDGE.LOOP_EXIT

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

    const hasOtherActiveIncoming = this.hasActiveIncomingEdges(targetNode, sourceId)
    if (!hasOtherActiveIncoming) {
      for (const [_, outgoingEdge] of targetNode.outgoingEdges) {
        this.deactivateEdgeAndDescendants(targetId, outgoingEdge.target, outgoingEdge.sourceHandle)
      }
    }
  }

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
