import type { LayoutEdge, LayoutNode, LayoutOptions, LayoutResult } from '../types'

interface LayerNode {
  node: LayoutNode
  layer: number
  position: number
}

/**
 * Hierarchical layout algorithm optimized for workflow visualization
 * Creates clear layers based on workflow flow with minimal edge crossings
 */
export function calculateHierarchicalLayout(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  options: LayoutOptions
): LayoutResult {
  const TIMEOUT_MS = 3000 // 3 second timeout for hierarchical layout
  const startTime = Date.now()

  const checkTimeout = () => {
    if (Date.now() - startTime > TIMEOUT_MS) {
      throw new Error('Hierarchical layout timeout')
    }
  }

  const { direction, spacing, alignment, padding } = options

  try {
    // Step 1: Determine layout direction
    checkTimeout()
    const isHorizontal =
      direction === 'horizontal' ||
      (direction === 'auto' && shouldUseHorizontalLayout(nodes, edges))

    // Step 2: Build adjacency lists
    checkTimeout()
    const { incomingEdges, outgoingEdges } = buildAdjacencyLists(edges)

    // Step 3: Assign nodes to layers using longest path layering
    checkTimeout()
    const layeredNodes = assignLayers(nodes, incomingEdges, outgoingEdges)

    // Step 4: Order nodes within layers to minimize crossings
    checkTimeout()
    const orderedLayers = minimizeCrossings(layeredNodes, edges, incomingEdges, outgoingEdges)

    // Step 5: Calculate positions
    checkTimeout()
    const positionedNodes = calculatePositions(
      orderedLayers,
      nodes,
      isHorizontal,
      spacing,
      alignment,
      padding
    )

    // Step 6: Calculate metadata
    const metadata = calculateLayoutMetadata(positionedNodes, edges, orderedLayers.length)

    return {
      nodes: positionedNodes,
      metadata: {
        ...metadata,
        strategy: 'hierarchical',
      },
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('timeout')) {
      // Fallback to simple linear layout
      return createSimpleLinearLayout(nodes, options)
    }
    throw error
  }
}

/**
 * Simple fallback layout when hierarchical layout times out
 */
function createSimpleLinearLayout(nodes: LayoutNode[], options: LayoutOptions): LayoutResult {
  const positions: Array<{ id: string; position: { x: number; y: number } }> = []
  const spacing = options.spacing.horizontal || 400
  const startX = options.padding?.x || 200
  const startY = options.padding?.y || 200

  nodes.forEach((node, index) => {
    positions.push({
      id: node.id,
      position: {
        x: startX + index * spacing,
        y: startY,
      },
    })
  })

  return {
    nodes: positions,
    metadata: {
      strategy: 'simple-linear',
      totalWidth: nodes.length * spacing,
      totalHeight: 200,
      layerCount: 1,
      stats: {
        crossings: 0,
        totalEdgeLength: 0,
        nodeOverlaps: 0,
      },
    },
  }
}

function shouldUseHorizontalLayout(nodes: LayoutNode[], edges: LayoutEdge[]): boolean {
  // Analyze edge directions and node handle preferences
  let horizontalPreference = 0

  nodes.forEach((node) => {
    if (node.horizontalHandles) horizontalPreference++
    else horizontalPreference--
  })

  // Analyze workflow complexity - simpler workflows work better horizontally
  const complexity = edges.length / Math.max(nodes.length, 1)
  if (complexity < 1.5) horizontalPreference += 2

  return horizontalPreference > 0
}

function buildAdjacencyLists(edges: LayoutEdge[]) {
  const incomingEdges = new Map<string, string[]>()
  const outgoingEdges = new Map<string, string[]>()

  edges.forEach((edge) => {
    if (!outgoingEdges.has(edge.source)) {
      outgoingEdges.set(edge.source, [])
    }
    if (!incomingEdges.has(edge.target)) {
      incomingEdges.set(edge.target, [])
    }

    outgoingEdges.get(edge.source)!.push(edge.target)
    incomingEdges.get(edge.target)!.push(edge.source)
  })

  return { incomingEdges, outgoingEdges }
}

function assignLayers(
  nodes: LayoutNode[],
  incomingEdges: Map<string, string[]>,
  outgoingEdges: Map<string, string[]>
): Map<number, LayoutNode[]> {
  const nodeToLayer = new Map<string, number>()
  const layers = new Map<number, LayoutNode[]>()

  // Find root nodes (no incoming edges)
  const rootNodes = nodes.filter(
    (node) => !incomingEdges.has(node.id) || incomingEdges.get(node.id)!.length === 0
  )

  // If no root nodes, pick nodes with highest category priority
  if (rootNodes.length === 0) {
    const triggerNodes = nodes.filter((node) => node.category === 'trigger')
    rootNodes.push(...(triggerNodes.length > 0 ? triggerNodes : [nodes[0]]))
  }

  // Assign layer 0 to root nodes
  rootNodes.forEach((node) => {
    nodeToLayer.set(node.id, 0)
  })

  // Use longest path layering algorithm with iteration limit
  let maxLayer = 0
  let changed = true
  let iterations = 0
  const maxIterations = nodes.length * 2 // Prevent infinite loops

  while (changed && iterations < maxIterations) {
    changed = false
    iterations++

    nodes.forEach((node) => {
      const predecessors = incomingEdges.get(node.id) || []

      if (predecessors.length > 0) {
        const maxPredecessorLayer = Math.max(
          ...predecessors.map((predId) => nodeToLayer.get(predId) || 0)
        )
        const currentLayer = nodeToLayer.get(node.id) || 0
        const newLayer = maxPredecessorLayer + 1

        if (newLayer > currentLayer) {
          nodeToLayer.set(node.id, newLayer)
          maxLayer = Math.max(maxLayer, newLayer)
          changed = true
        }
      }
    })
  }

  if (iterations >= maxIterations) {
    console.warn('Layer assignment reached maximum iterations, may have cycles in graph')
  }

  // Group nodes by layer
  nodes.forEach((node) => {
    const layer = nodeToLayer.get(node.id) || 0
    if (!layers.has(layer)) {
      layers.set(layer, [])
    }
    layers.get(layer)!.push(node)
  })

  return layers
}

function minimizeCrossings(
  layeredNodes: Map<number, LayoutNode[]>,
  edges: LayoutEdge[],
  incomingEdges: Map<string, string[]>,
  outgoingEdges: Map<string, string[]>
): LayoutNode[][] {
  const layers: LayoutNode[][] = []
  const maxLayer = Math.max(...layeredNodes.keys())

  // Initialize layers
  for (let i = 0; i <= maxLayer; i++) {
    layers[i] = layeredNodes.get(i) || []
  }

  // Apply barycenter heuristic for crossing minimization with limited iterations
  const maxIterations = Math.min(4, Math.max(1, Math.ceil(maxLayer / 2)))
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (iteration % 2 === 0) {
      // Forward pass
      for (let layer = 1; layer <= maxLayer; layer++) {
        sortLayerByBarycenter(layers[layer], layers[layer - 1], incomingEdges, true)
      }
    } else {
      // Backward pass
      for (let layer = maxLayer - 1; layer >= 0; layer--) {
        sortLayerByBarycenter(layers[layer], layers[layer + 1], outgoingEdges, false)
      }
    }
  }

  return layers
}

function sortLayerByBarycenter(
  currentLayer: LayoutNode[],
  adjacentLayer: LayoutNode[],
  edgeMap: Map<string, string[]>,
  useIncoming: boolean
) {
  const barycenters: Array<{ node: LayoutNode; barycenter: number }> = []

  currentLayer.forEach((node) => {
    const connectedNodes = edgeMap.get(node.id) || []
    let barycenter = 0

    if (connectedNodes.length > 0) {
      const positions = connectedNodes
        .map((connectedId) => adjacentLayer.findIndex((n) => n.id === connectedId))
        .filter((pos) => pos !== -1)

      if (positions.length > 0) {
        barycenter = positions.reduce((sum, pos) => sum + pos, 0) / positions.length
      }
    }

    barycenters.push({ node, barycenter })
  })

  // Sort by barycenter, then by category priority, then by name for stability
  barycenters.sort((a, b) => {
    if (Math.abs(a.barycenter - b.barycenter) < 0.1) {
      const priorityA = getCategoryPriority(a.node.category)
      const priorityB = getCategoryPriority(b.node.category)
      if (priorityA !== priorityB) return priorityA - priorityB
      return a.node.name.localeCompare(b.node.name)
    }
    return a.barycenter - b.barycenter
  })

  // Update layer order
  currentLayer.splice(0, currentLayer.length, ...barycenters.map((item) => item.node))
}

function getCategoryPriority(category: LayoutNode['category']): number {
  const priorities = {
    trigger: 0,
    processing: 1,
    logic: 2,
    container: 3,
    output: 4,
  }
  return priorities[category] || 10
}

function calculatePositions(
  layers: LayoutNode[][],
  allNodes: LayoutNode[],
  isHorizontal: boolean,
  spacing: LayoutOptions['spacing'],
  alignment: LayoutOptions['alignment'],
  padding: LayoutOptions['padding']
): Array<{ id: string; position: { x: number; y: number } }> {
  const positions: Array<{ id: string; position: { x: number; y: number } }> = []

  if (isHorizontal) {
    // Horizontal layout (left-to-right)
    let currentX = padding.x

    layers.forEach((layer, layerIndex) => {
      // Calculate layer width (max node width in this layer)
      const layerWidth = Math.max(...layer.map((node) => node.width), 0)

      // Calculate total layer height
      const totalHeight =
        layer.reduce((sum, node) => sum + node.height, 0) + (layer.length - 1) * spacing.vertical

      // Starting Y position based on alignment
      let startY: number
      switch (alignment) {
        case 'start':
          startY = padding.y
          break
        case 'end':
          startY = -totalHeight + padding.y
          break
        default:
          startY = -totalHeight / 2 + padding.y
          break
      }

      let currentY = startY

      layer.forEach((node) => {
        positions.push({
          id: node.id,
          position: { x: currentX, y: currentY },
        })
        currentY += node.height + spacing.vertical
      })

      currentX += layerWidth + spacing.layer
    })
  } else {
    // Vertical layout (top-to-bottom)
    let currentY = padding.y

    layers.forEach((layer, layerIndex) => {
      // Calculate layer height (max node height in this layer)
      const layerHeight = Math.max(...layer.map((node) => node.height), 0)

      // Calculate total layer width
      const totalWidth =
        layer.reduce((sum, node) => sum + node.width, 0) + (layer.length - 1) * spacing.horizontal

      // Starting X position based on alignment
      let startX: number
      switch (alignment) {
        case 'start':
          startX = padding.x
          break
        case 'end':
          startX = -totalWidth + padding.x
          break
        default:
          startX = -totalWidth / 2 + padding.x
          break
      }

      let currentX = startX

      layer.forEach((node) => {
        positions.push({
          id: node.id,
          position: { x: currentX, y: currentY },
        })
        currentX += node.width + spacing.horizontal
      })

      currentY += layerHeight + spacing.layer
    })
  }

  return positions
}

function calculateLayoutMetadata(
  positions: Array<{ id: string; position: { x: number; y: number } }>,
  edges: LayoutEdge[],
  layerCount: number
) {
  const nodeMap = new Map(positions.map((p) => [p.id, p.position]))

  // Calculate bounding box
  const xs = positions.map((p) => p.position.x)
  const ys = positions.map((p) => p.position.y)
  const totalWidth = Math.max(...xs) - Math.min(...xs)
  const totalHeight = Math.max(...ys) - Math.min(...ys)

  // Calculate total edge length
  let totalEdgeLength = 0
  edges.forEach((edge) => {
    const sourcePos = nodeMap.get(edge.source)
    const targetPos = nodeMap.get(edge.target)
    if (sourcePos && targetPos) {
      const dx = targetPos.x - sourcePos.x
      const dy = targetPos.y - sourcePos.y
      totalEdgeLength += Math.sqrt(dx * dx + dy * dy)
    }
  })

  return {
    totalWidth,
    totalHeight,
    layerCount,
    stats: {
      crossings: 0, // TODO: Implement crossing calculation
      totalEdgeLength,
      nodeOverlaps: 0, // No overlaps in hierarchical layout
    },
  }
}
