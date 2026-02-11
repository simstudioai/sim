import { createLogger } from '@sim/logger'
import {
  CONTAINER_LAYOUT_OPTIONS,
  DEFAULT_LAYOUT_OPTIONS,
  MAX_OVERLAP_ITERATIONS,
} from '@/lib/workflows/autolayout/constants'
import type { Edge, GraphNode, LayoutOptions } from '@/lib/workflows/autolayout/types'
import {
  getBlockMetrics,
  normalizePositions,
  prepareBlockMetrics,
  snapNodesToGrid,
} from '@/lib/workflows/autolayout/utils'
import { BLOCK_DIMENSIONS, HANDLE_POSITIONS } from '@/lib/workflows/blocks/block-dimensions'
import { EDGE } from '@/executor/constants'
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('AutoLayout:Core')

const SUBFLOW_END_HANDLES = new Set(['loop-end-source', 'parallel-end-source'])
const SUBFLOW_START_HANDLES = new Set(['loop-start-source', 'parallel-start-source'])

/**
 * Calculates the Y offset for a source handle based on block type and handle ID.
 */
function getSourceHandleYOffset(block: BlockState, sourceHandle?: string | null): number {
  if (sourceHandle === 'error') {
    const blockHeight = block.height || BLOCK_DIMENSIONS.MIN_HEIGHT
    return blockHeight - HANDLE_POSITIONS.ERROR_BOTTOM_OFFSET
  }

  if (sourceHandle && SUBFLOW_START_HANDLES.has(sourceHandle)) {
    return HANDLE_POSITIONS.SUBFLOW_START_Y_OFFSET
  }

  if (block.type === 'condition' && sourceHandle?.startsWith(EDGE.CONDITION_PREFIX)) {
    const conditionId = sourceHandle.replace(EDGE.CONDITION_PREFIX, '')
    try {
      const conditionsValue = block.subBlocks?.conditions?.value
      if (typeof conditionsValue === 'string' && conditionsValue) {
        const conditions = JSON.parse(conditionsValue) as Array<{ id?: string }>
        const conditionIndex = conditions.findIndex((c) => c.id === conditionId)
        if (conditionIndex >= 0) {
          return (
            HANDLE_POSITIONS.CONDITION_START_Y +
            conditionIndex * HANDLE_POSITIONS.CONDITION_ROW_HEIGHT
          )
        }
      }
    } catch {
      // Fall back to default offset
    }
  }

  return HANDLE_POSITIONS.DEFAULT_Y_OFFSET
}

/**
 * Calculates the Y offset for a target handle based on block type and handle ID.
 */
function getTargetHandleYOffset(_block: BlockState, _targetHandle?: string | null): number {
  return HANDLE_POSITIONS.DEFAULT_Y_OFFSET
}

/**
 * Checks if an edge comes from a subflow end handle
 */
function isSubflowEndEdge(edge: Edge): boolean {
  return edge.sourceHandle != null && SUBFLOW_END_HANDLES.has(edge.sourceHandle)
}

/**
 * Assigns layers (columns) to blocks using topological sort.
 * Blocks with no incoming edges are placed in layer 0.
 * When edges come from subflow end handles, the subflow's internal depth is added.
 *
 * @param blocks - The blocks to assign layers to
 * @param edges - The edges connecting blocks
 * @param subflowDepths - Optional map of container block IDs to their internal depth (max layers inside)
 */
export function assignLayers(
  blocks: Record<string, BlockState>,
  edges: Edge[],
  subflowDepths?: Map<string, number>
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

  const incomingEdgesMap = new Map<string, Edge[]>()
  for (const edge of edges) {
    if (!incomingEdgesMap.has(edge.target)) {
      incomingEdgesMap.set(edge.target, [])
    }
    incomingEdgesMap.get(edge.target)!.push(edge)
  }

  for (const edge of edges) {
    const sourceNode = nodes.get(edge.source)
    const targetNode = nodes.get(edge.target)

    if (sourceNode && targetNode) {
      sourceNode.outgoing.add(edge.target)
      targetNode.incoming.add(edge.source)
    }
  }

  const starterNodes = Array.from(nodes.values()).filter((node) => node.incoming.size === 0)

  if (starterNodes.length === 0 && nodes.size > 0) {
    const firstNode = Array.from(nodes.values())[0]
    starterNodes.push(firstNode)
    logger.warn('No starter blocks found, using first block as starter', { blockId: firstNode.id })
  }

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

    if (node.incoming.size > 0) {
      let maxEffectiveLayer = -1
      const incomingEdges = incomingEdgesMap.get(nodeId) || []

      for (const incomingId of node.incoming) {
        const incomingNode = nodes.get(incomingId)
        if (incomingNode) {
          const edgesFromSource = incomingEdges.filter((e) => e.source === incomingId)
          let additionalDepth = 0

          const hasSubflowEndEdge = edgesFromSource.some(isSubflowEndEdge)
          if (hasSubflowEndEdge && subflowDepths) {
            const depth = subflowDepths.get(incomingId) ?? 1
            additionalDepth = Math.max(0, depth - 1)
          }

          const effectiveLayer = incomingNode.layer + additionalDepth
          maxEffectiveLayer = Math.max(maxEffectiveLayer, effectiveLayer)
        }
      }
      node.layer = maxEffectiveLayer + 1
    }

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
 * Resolves vertical overlaps between nodes in the same layer.
 * X overlaps are prevented by construction via cumulative width-based positioning.
 */
function resolveVerticalOverlaps(nodes: GraphNode[], verticalSpacing: number): void {
  let iteration = 0
  let hasOverlap = true

  while (hasOverlap && iteration < MAX_OVERLAP_ITERATIONS) {
    hasOverlap = false
    iteration++

    const nodesByLayer = new Map<number, GraphNode[]>()
    for (const node of nodes) {
      if (!nodesByLayer.has(node.layer)) {
        nodesByLayer.set(node.layer, [])
      }
      nodesByLayer.get(node.layer)!.push(node)
    }

    for (const [layer, layerNodes] of nodesByLayer) {
      if (layerNodes.length < 2) continue

      layerNodes.sort((a, b) => a.position.y - b.position.y)

      for (let i = 0; i < layerNodes.length - 1; i++) {
        const node1 = layerNodes[i]
        const node2 = layerNodes[i + 1]

        const node1Bottom = node1.position.y + node1.metrics.height
        const requiredY = node1Bottom + verticalSpacing

        if (node2.position.y < requiredY) {
          hasOverlap = true
          node2.position.y = requiredY

          logger.debug('Resolved vertical overlap in layer', {
            layer,
            block1: node1.id,
            block2: node2.id,
            iteration,
          })
        }
      }
    }
  }

  if (hasOverlap) {
    logger.warn('Could not fully resolve all vertical overlaps after max iterations', {
      iterations: MAX_OVERLAP_ITERATIONS,
    })
  }
}

/**
 * Checks if a block is a container type (loop or parallel)
 */
function isContainerBlock(node: GraphNode): boolean {
  return node.block.type === 'loop' || node.block.type === 'parallel'
}

/**
 * Extra vertical spacing after containers to prevent edge crossings with sibling blocks.
 * This creates clearance for edges from container ends to route cleanly.
 */
const CONTAINER_VERTICAL_CLEARANCE = 120

/**
 * Calculates positions for nodes organized by layer.
 * Uses cumulative width-based X positioning to properly handle containers of varying widths.
 * Aligns blocks based on their connected predecessors to achieve handle-to-handle alignment.
 *
 * Handle alignment: Calculates actual source handle Y positions based on block type
 * (condition blocks have handles at different heights for each branch).
 * Target handles are also calculated per-block to ensure precise alignment.
 */
export function calculatePositions(
  layers: Map<number, GraphNode[]>,
  edges: Edge[],
  options: LayoutOptions = {}
): void {
  const horizontalSpacing = options.horizontalSpacing ?? DEFAULT_LAYOUT_OPTIONS.horizontalSpacing
  const verticalSpacing = options.verticalSpacing ?? DEFAULT_LAYOUT_OPTIONS.verticalSpacing
  const padding = options.padding ?? DEFAULT_LAYOUT_OPTIONS.padding

  const layerNumbers = Array.from(layers.keys()).sort((a, b) => a - b)

  const layerWidths = new Map<number, number>()
  for (const layerNum of layerNumbers) {
    const nodesInLayer = layers.get(layerNum)!
    const maxWidth = Math.max(...nodesInLayer.map((n) => n.metrics.width))
    layerWidths.set(layerNum, maxWidth)
  }

  const layerXPositions = new Map<number, number>()
  let cumulativeX = padding.x

  for (const layerNum of layerNumbers) {
    layerXPositions.set(layerNum, cumulativeX)
    cumulativeX += layerWidths.get(layerNum)! + horizontalSpacing
  }

  const allNodes = new Map<string, GraphNode>()
  for (const nodesInLayer of layers.values()) {
    for (const node of nodesInLayer) {
      allNodes.set(node.id, node)
    }
  }

  const incomingEdgesMap = new Map<string, Edge[]>()
  for (const edge of edges) {
    if (!incomingEdgesMap.has(edge.target)) {
      incomingEdgesMap.set(edge.target, [])
    }
    incomingEdgesMap.get(edge.target)!.push(edge)
  }

  for (const layerNum of layerNumbers) {
    const nodesInLayer = layers.get(layerNum)!
    const xPosition = layerXPositions.get(layerNum)!

    const containersInLayer = nodesInLayer.filter(isContainerBlock)
    const nonContainersInLayer = nodesInLayer.filter((n) => !isContainerBlock(n))

    if (layerNum === 0) {
      let yOffset = padding.y

      containersInLayer.sort((a, b) => b.metrics.height - a.metrics.height)

      for (const node of containersInLayer) {
        node.position = { x: xPosition, y: yOffset }
        yOffset += node.metrics.height + verticalSpacing
      }

      if (containersInLayer.length > 0 && nonContainersInLayer.length > 0) {
        yOffset += CONTAINER_VERTICAL_CLEARANCE
      }

      nonContainersInLayer.sort((a, b) => b.outgoing.size - a.outgoing.size)

      for (const node of nonContainersInLayer) {
        node.position = { x: xPosition, y: yOffset }
        yOffset += node.metrics.height + verticalSpacing
      }
      continue
    }

    for (const node of [...containersInLayer, ...nonContainersInLayer]) {
      let bestSourceHandleY = -1
      let bestEdge: Edge | null = null
      const incomingEdges = incomingEdgesMap.get(node.id) || []

      for (const edge of incomingEdges) {
        const predecessor = allNodes.get(edge.source)
        if (predecessor) {
          const sourceHandleOffset = getSourceHandleYOffset(predecessor.block, edge.sourceHandle)
          const sourceHandleY = predecessor.position.y + sourceHandleOffset

          if (sourceHandleY > bestSourceHandleY) {
            bestSourceHandleY = sourceHandleY
            bestEdge = edge
          }
        }
      }

      if (bestSourceHandleY < 0) {
        bestSourceHandleY = padding.y + HANDLE_POSITIONS.DEFAULT_Y_OFFSET
      }

      const targetHandleOffset = getTargetHandleYOffset(node.block, bestEdge?.targetHandle)

      node.position = { x: xPosition, y: bestSourceHandleY - targetHandleOffset }
    }
  }

  resolveVerticalOverlaps(Array.from(layers.values()).flat(), verticalSpacing)
}

/**
 * Core layout function that performs the complete layout pipeline:
 * 1. Assign layers using topological sort
 * 2. Prepare block metrics
 * 3. Group nodes by layer
 * 4. Calculate positions
 * 5. Normalize positions to start from padding
 *
 * @param blocks - The blocks to lay out
 * @param edges - The edges connecting blocks
 * @param options - Layout options including container flag and subflow depths
 * @returns The laid-out nodes with updated positions, and bounding dimensions
 */
export function layoutBlocksCore(
  blocks: Record<string, BlockState>,
  edges: Edge[],
  options: {
    isContainer: boolean
    layoutOptions?: LayoutOptions
    subflowDepths?: Map<string, number>
  }
): { nodes: Map<string, GraphNode>; dimensions: { width: number; height: number } } {
  if (Object.keys(blocks).length === 0) {
    return { nodes: new Map(), dimensions: { width: 0, height: 0 } }
  }

  const layoutOptions: LayoutOptions =
    options.layoutOptions ??
    (options.isContainer ? CONTAINER_LAYOUT_OPTIONS : DEFAULT_LAYOUT_OPTIONS)

  // 1. Assign layers (with subflow depth adjustment for subflow end edges)
  const nodes = assignLayers(blocks, edges, options.subflowDepths)

  // 2. Prepare metrics
  prepareBlockMetrics(nodes)

  // 3. Group by layer
  const layers = groupByLayer(nodes)

  // 4. Calculate positions (pass edges for handle offset calculations)
  calculatePositions(layers, edges, layoutOptions)

  // 5. Normalize positions
  let dimensions = normalizePositions(nodes, { isContainer: options.isContainer })

  // 6. Snap to grid if gridSize is specified (recalculates dimensions)
  const snappedDimensions = snapNodesToGrid(nodes, layoutOptions.gridSize)
  if (snappedDimensions) {
    dimensions = snappedDimensions
  }

  return { nodes, dimensions }
}
