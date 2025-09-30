import { createLogger } from '@/lib/logs/console/logger'
import type { BlockState } from '@/stores/workflows/workflow/types'
import type { Edge, GraphNode } from './types'
import { getBlockDimensions, isStarterBlock } from './utils'

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
      dimensions: getBlockDimensions(block),
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

  const starterNodes = Array.from(nodes.values()).filter(
    (node) => node.incoming.size === 0 || isStarterBlock(node.block)
  )

  if (starterNodes.length === 0 && nodes.size > 0) {
    const firstNode = Array.from(nodes.values())[0]
    starterNodes.push(firstNode)
    logger.warn('No starter blocks found, using first block as starter', { blockId: firstNode.id })
  }

  const visited = new Set<string>()
  const queue: Array<{ nodeId: string; layer: number }> = []

  for (const starter of starterNodes) {
    starter.layer = 0
    queue.push({ nodeId: starter.id, layer: 0 })
  }

  while (queue.length > 0) {
    const { nodeId, layer } = queue.shift()!

    if (visited.has(nodeId)) {
      continue
    }

    visited.add(nodeId)
    const node = nodes.get(nodeId)!
    node.layer = Math.max(node.layer, layer)

    for (const targetId of node.outgoing) {
      const targetNode = nodes.get(targetId)
      if (targetNode) {
        queue.push({ nodeId: targetId, layer: layer + 1 })
      }
    }
  }

  for (const node of nodes.values()) {
    if (!visited.has(node.id)) {
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
