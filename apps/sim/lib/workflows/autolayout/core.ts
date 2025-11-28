import { createLogger } from '@/lib/logs/console/logger'
import {
  CONTAINER_LAYOUT_OPTIONS,
  DEFAULT_LAYOUT_OPTIONS,
  MAX_OVERLAP_ITERATIONS,
  OVERLAP_MARGIN,
} from '@/lib/workflows/autolayout/constants'
import type { Edge, GraphNode, LayoutOptions } from '@/lib/workflows/autolayout/types'
import {
  boxesOverlap,
  createBoundingBox,
  getBlockMetrics,
  normalizePositions,
  prepareBlockMetrics,
} from '@/lib/workflows/autolayout/utils'
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('AutoLayout:Core')

/**
 * Assigns layers (columns) to blocks using topological sort.
 * Blocks with no incoming edges are placed in layer 0.
 */
export function assignLayers(
  blocks: Record<string, BlockState>,
  edges: Edge[]
): Map<string, GraphNode> {
  const nodes = new Map<string, GraphNode>()

  // Initialize nodes
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

  // Build adjacency from edges
  for (const edge of edges) {
    const sourceNode = nodes.get(edge.source)
    const targetNode = nodes.get(edge.target)

    if (sourceNode && targetNode) {
      sourceNode.outgoing.add(edge.target)
      targetNode.incoming.add(edge.source)
    }
  }

  // Find starter nodes (no incoming edges)
  const starterNodes = Array.from(nodes.values()).filter((node) => node.incoming.size === 0)

  if (starterNodes.length === 0 && nodes.size > 0) {
    const firstNode = Array.from(nodes.values())[0]
    starterNodes.push(firstNode)
    logger.warn('No starter blocks found, using first block as starter', { blockId: firstNode.id })
  }

  // Topological sort using Kahn's algorithm
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

    // Calculate layer based on max incoming layer + 1
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

    // Add outgoing nodes when all dependencies processed
    for (const targetId of node.outgoing) {
      const currentCount = inDegreeCount.get(targetId) || 0
      inDegreeCount.set(targetId, currentCount - 1)

      if (inDegreeCount.get(targetId) === 0 && !processed.has(targetId)) {
        queue.push(targetId)
      }
    }
  }

  // Handle isolated nodes
  for (const node of nodes.values()) {
    if (!processed.has(node.id)) {
      logger.debug('Isolated node detected, assigning to layer 0', { blockId: node.id })
      node.layer = 0
    }
  }

  return nodes
}

/**
 * Groups nodes by their layer number
 */
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

/**
 * Resolves overlaps between all nodes, including across layers.
 * Nodes in the same layer are shifted vertically to avoid overlap.
 * Nodes in different layers that overlap are shifted down.
 */
function resolveOverlaps(nodes: GraphNode[], verticalSpacing: number): void {
  let iteration = 0
  let hasOverlap = true

  while (hasOverlap && iteration < MAX_OVERLAP_ITERATIONS) {
    hasOverlap = false
    iteration++

    // Sort nodes by layer then by Y position for consistent processing
    const sortedNodes = [...nodes].sort((a, b) => {
      if (a.layer !== b.layer) return a.layer - b.layer
      return a.position.y - b.position.y
    })

    for (let i = 0; i < sortedNodes.length; i++) {
      for (let j = i + 1; j < sortedNodes.length; j++) {
        const node1 = sortedNodes[i]
        const node2 = sortedNodes[j]

        const box1 = createBoundingBox(node1.position, node1.metrics)
        const box2 = createBoundingBox(node2.position, node2.metrics)

        // Check for overlap with margin
        if (boxesOverlap(box1, box2, OVERLAP_MARGIN)) {
          hasOverlap = true

          // If in same layer, shift vertically around midpoint
          if (node1.layer === node2.layer) {
            const midpoint = (node1.position.y + node2.position.y) / 2

            node1.position.y = midpoint - node1.metrics.height / 2 - verticalSpacing / 2
            node2.position.y = midpoint + node2.metrics.height / 2 + verticalSpacing / 2
          } else {
            // Different layers - shift the later one down
            const requiredSpace = box1.y + box1.height + verticalSpacing
            if (node2.position.y < requiredSpace) {
              node2.position.y = requiredSpace
            }
          }

          logger.debug('Resolved overlap between blocks', {
            block1: node1.id,
            block2: node2.id,
            sameLayer: node1.layer === node2.layer,
            iteration,
          })
        }
      }
    }
  }

  if (hasOverlap) {
    logger.warn('Could not fully resolve all overlaps after max iterations', {
      iterations: MAX_OVERLAP_ITERATIONS,
    })
  }
}

/**
 * Calculates positions for nodes organized by layer
 */
export function calculatePositions(
  layers: Map<number, GraphNode[]>,
  options: LayoutOptions = {}
): void {
  const horizontalSpacing = options.horizontalSpacing ?? DEFAULT_LAYOUT_OPTIONS.horizontalSpacing
  const verticalSpacing = options.verticalSpacing ?? DEFAULT_LAYOUT_OPTIONS.verticalSpacing
  const padding = options.padding ?? DEFAULT_LAYOUT_OPTIONS.padding
  const alignment = options.alignment ?? DEFAULT_LAYOUT_OPTIONS.alignment

  const layerNumbers = Array.from(layers.keys()).sort((a, b) => a - b)

  for (const layerNum of layerNumbers) {
    const nodesInLayer = layers.get(layerNum)!
    const xPosition = padding.x + layerNum * horizontalSpacing

    // Calculate total height for this layer
    const totalHeight = nodesInLayer.reduce(
      (sum, node, idx) => sum + node.metrics.height + (idx > 0 ? verticalSpacing : 0),
      0
    )

    // Start Y based on alignment
    let yOffset: number
    switch (alignment) {
      case 'start':
        yOffset = padding.y
        break
      case 'center':
        yOffset = Math.max(padding.y, 300 - totalHeight / 2)
        break
      case 'end':
        yOffset = 600 - totalHeight - padding.y
        break
      default:
        yOffset = padding.y
        break
    }

    // Position each node
    for (const node of nodesInLayer) {
      node.position = {
        x: xPosition,
        y: yOffset,
      }
      yOffset += node.metrics.height + verticalSpacing
    }
  }

  // Resolve overlaps across all nodes
  resolveOverlaps(Array.from(layers.values()).flat(), verticalSpacing)
}

/**
 * Core layout function that performs the complete layout pipeline:
 * 1. Assign layers using topological sort
 * 2. Prepare block metrics
 * 3. Group nodes by layer
 * 4. Calculate positions
 * 5. Normalize positions to start from padding
 *
 * @returns The laid-out nodes with updated positions, and bounding dimensions
 */
export function layoutBlocksCore(
  blocks: Record<string, BlockState>,
  edges: Edge[],
  options: { isContainer: boolean; layoutOptions?: LayoutOptions }
): { nodes: Map<string, GraphNode>; dimensions: { width: number; height: number } } {
  if (Object.keys(blocks).length === 0) {
    return { nodes: new Map(), dimensions: { width: 0, height: 0 } }
  }

  const layoutOptions =
    options.layoutOptions ??
    (options.isContainer ? CONTAINER_LAYOUT_OPTIONS : DEFAULT_LAYOUT_OPTIONS)

  // 1. Assign layers
  const nodes = assignLayers(blocks, edges)

  // 2. Prepare metrics
  prepareBlockMetrics(nodes)

  // 3. Group by layer
  const layers = groupByLayer(nodes)

  // 4. Calculate positions
  calculatePositions(layers, layoutOptions)

  // 5. Normalize positions
  const dimensions = normalizePositions(nodes, { isContainer: options.isContainer })

  return { nodes, dimensions }
}
