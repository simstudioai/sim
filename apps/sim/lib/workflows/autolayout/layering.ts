import { createLogger } from '@/lib/logs/console/logger'
import type { BlockState } from '@/stores/workflows/workflow/types'
import type { Edge, GraphNode } from './types'
import { getBlockMetrics } from './utils'

const logger = createLogger('AutoLayout:Layering')

export function assignLayers(
  blocks: Record<string, BlockState>,
  edges: Edge[]
): Map<string, GraphNode> {
  const nodes = new Map<string, GraphNode>()

  for (const [id, block] of Object.entries(blocks)) {
    nodes.set(id, {
      id,
      block,
      metrics: getBlockMetrics(block),
      incoming: new Set(),
      outgoing: new Set(),
      layer: 0,
      position: { ...block.position },
    })
  }

  for (const edge of edges) {
    const sourceNode = nodes.get(edge.source)
    const targetNode = nodes.get(edge.target)

    if (sourceNode && targetNode) {
      sourceNode.outgoing.add(edge.target)
      targetNode.incoming.add(edge.source)
    }
  }

  // Only treat blocks as starters if they have no incoming edges
  // This prevents triggers that are mid-flow from being forced to layer 0
  const starterNodes = Array.from(nodes.values()).filter((node) => node.incoming.size === 0)

  if (starterNodes.length === 0 && nodes.size > 0) {
    const firstNode = Array.from(nodes.values())[0]
    starterNodes.push(firstNode)
    logger.warn('No starter blocks found, using first block as starter', { blockId: firstNode.id })
  }

  // Use topological sort to ensure proper layering based on dependencies
  // Each node's layer = max(all incoming nodes' layers) + 1
  const inDegreeCount = new Map<string, number>()

  for (const node of nodes.values()) {
    inDegreeCount.set(node.id, node.incoming.size)
    if (starterNodes.includes(node)) {
      node.layer = 0
    }
  }

  const queue: string[] = starterNodes.map((n) => n.id)
  const processed = new Set<string>()

  while (queue.length > 0) {
    const nodeId = queue.shift()!
    const node = nodes.get(nodeId)!
    processed.add(nodeId)

    // Calculate this node's layer based on all incoming edges
    if (node.incoming.size > 0) {
      let maxIncomingLayer = -1
      for (const incomingId of node.incoming) {
        const incomingNode = nodes.get(incomingId)
        if (incomingNode) {
          maxIncomingLayer = Math.max(maxIncomingLayer, incomingNode.layer)
        }
      }
      node.layer = maxIncomingLayer + 1
    }

    // Add outgoing nodes to queue when all their dependencies are processed
    for (const targetId of node.outgoing) {
      const currentCount = inDegreeCount.get(targetId) || 0
      inDegreeCount.set(targetId, currentCount - 1)

      if (inDegreeCount.get(targetId) === 0 && !processed.has(targetId)) {
        queue.push(targetId)
      }
    }
  }

  for (const node of nodes.values()) {
    if (!processed.has(node.id)) {
      logger.debug('Isolated node detected, assigning to layer 0', { blockId: node.id })
      node.layer = 0
    }
  }

  return nodes
}

export function groupByLayer(nodes: Map<string, GraphNode>): Map<number, GraphNode[]> {
  const layers = new Map<number, GraphNode[]>()

  for (const node of nodes.values()) {
    if (!layers.has(node.layer)) {
      layers.set(node.layer, [])
    }
    layers.get(node.layer)!.push(node)
  }

  return layers
}
