import type { Edge } from 'reactflow'
import { createLogger } from '@/lib/logs/console/logger'
import type { BlockState, Position } from '@/stores/workflows/workflow/types'
import type { AutoLayoutOptions } from './auto-layout'

const logger = createLogger('LocalAutoLayoutUtils')

/**
 * Default auto layout options
 */
export const DEFAULT_AUTO_LAYOUT_OPTIONS: AutoLayoutOptions = {
  strategy: 'smart',
  direction: 'auto',
  spacing: {
    horizontal: 250,
    vertical: 200,
    layer: 350,
  },
  alignment: 'center',
  padding: {
    x: 125,
    y: 125,
  },
}

/**
 * Local auto-layout implementation using intelligent graph-based positioning
 * This analyzes the workflow structure and positions blocks based on their
 * connections, dimensions, and handle directions
 */
export async function applyLocalAutoLayout(
  workflowId: string,
  blocks: Record<string, BlockState>,
  edges: Edge[],
  loops: Record<string, any> = {},
  parallels: Record<string, any> = {},
  options: AutoLayoutOptions = {}
): Promise<{
  success: boolean
  layoutedBlocks?: Record<string, BlockState>
  error?: string
}> {
  try {
    logger.info('Applying local auto layout', {
      workflowId,
      blockCount: Object.keys(blocks).length,
      edgeCount: edges.length,
    })

    // Merge with defaults
    const layoutOptions = {
      ...DEFAULT_AUTO_LAYOUT_OPTIONS,
      ...options,
      spacing: {
        ...DEFAULT_AUTO_LAYOUT_OPTIONS.spacing,
        ...options.spacing,
      },
      padding: {
        ...DEFAULT_AUTO_LAYOUT_OPTIONS.padding,
        ...options.padding,
      },
    }

    // Step 1: Build graph structure
    const graph = buildGraphStructure(blocks, edges)

    // Step 2: Detect if we should use vertical or horizontal layout
    const preferVertical = shouldUseVerticalLayout(blocks, graph)
    const direction =
      layoutOptions.direction === 'auto'
        ? preferVertical
          ? 'vertical'
          : 'horizontal'
        : layoutOptions.direction!

    // Step 3: Assign blocks to layers using topological sort
    const layers = assignBlocksToLayers(graph, blocks)

    // Step 4: Order blocks within each layer to minimize crossings
    const orderedLayers = minimizeCrossings(layers, edges, blocks)

    // Step 5: Calculate positions based on dimensions
    const layoutedBlocks = calculateBlockPositions(
      orderedLayers,
      blocks,
      edges,
      direction,
      layoutOptions as {
        strategy: 'smart' | 'hierarchical' | 'layered' | 'force-directed'
        direction: 'horizontal' | 'vertical' | 'auto'
        spacing: {
          horizontal: number
          vertical: number
          layer: number
        }
        alignment: 'start' | 'center' | 'end'
        padding: {
          x: number
          y: number
        }
      }
    )

    logger.info('Local auto layout completed successfully', {
      workflowId,
      layerCount: orderedLayers.length,
    })

    return {
      success: true,
      layoutedBlocks,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown auto layout error'
    logger.error('Local auto layout failed:', { workflowId, error: errorMessage })

    return {
      success: false,
      error: errorMessage,
    }
  }
}

/**
 * Graph node structure for layout algorithm
 */
interface GraphNode {
  id: string
  incoming: string[]
  outgoing: string[]
  layer?: number
}

/**
 * Build adjacency list representation of the workflow graph
 */
function buildGraphStructure(
  blocks: Record<string, BlockState>,
  edges: Edge[]
): Record<string, GraphNode> {
  const graph: Record<string, GraphNode> = {}

  // Initialize nodes
  Object.keys(blocks).forEach((blockId) => {
    graph[blockId] = {
      id: blockId,
      incoming: [],
      outgoing: [],
    }
  })

  // Build connections from edges
  edges.forEach((edge) => {
    if (graph[edge.source] && graph[edge.target]) {
      graph[edge.source].outgoing.push(edge.target)
      graph[edge.target].incoming.push(edge.source)
    }
  })

  return graph
}

/**
 * Determine if vertical layout is preferred based on handle directions
 */
function shouldUseVerticalLayout(
  blocks: Record<string, BlockState>,
  graph: Record<string, GraphNode>
): boolean {
  let verticalHandleCount = 0
  let horizontalHandleCount = 0

  Object.values(blocks).forEach((block) => {
    // Count based on horizontalHandles property
    if (block.horizontalHandles === false) {
      verticalHandleCount++
    } else {
      horizontalHandleCount++
    }
  })

  // Prefer vertical layout if more blocks have vertical handles
  return verticalHandleCount > horizontalHandleCount
}

/**
 * Assign blocks to layers using modified topological sort
 * Handles cycles gracefully by breaking them
 */
function assignBlocksToLayers(
  graph: Record<string, GraphNode>,
  blocks: Record<string, BlockState>
): string[][] {
  const layers: string[][] = []
  const visited = new Set<string>()
  const nodeLayer = new Map<string, number>()

  // Find root nodes (no incoming edges) - typically starter blocks
  const roots = Object.values(graph).filter(
    (node) => node.incoming.length === 0 || blocks[node.id]?.type === 'starter'
  )

  if (roots.length === 0) {
    // No clear roots, pick nodes with fewest dependencies
    const sortedNodes = Object.values(graph).sort((a, b) => a.incoming.length - b.incoming.length)
    roots.push(sortedNodes[0])
  }

  // BFS to assign layers
  const queue: { node: GraphNode; layer: number }[] = roots.map((node) => ({ node, layer: 0 }))

  while (queue.length > 0) {
    const { node, layer } = queue.shift()!

    if (visited.has(node.id)) continue
    visited.add(node.id)

    // Ensure layer exists
    if (!layers[layer]) layers[layer] = []
    layers[layer].push(node.id)
    nodeLayer.set(node.id, layer)

    // Add outgoing nodes to next layer
    node.outgoing.forEach((targetId) => {
      if (!visited.has(targetId)) {
        const targetNode = graph[targetId]
        if (targetNode) {
          // Check if all dependencies are satisfied
          const dependenciesSatisfied = targetNode.incoming.every((depId) => visited.has(depId))

          if (dependenciesSatisfied) {
            queue.push({ node: targetNode, layer: layer + 1 })
          }
        }
      }
    })
  }

  // Handle any unvisited nodes (disconnected components)
  Object.values(graph).forEach((node) => {
    if (!visited.has(node.id)) {
      const lastLayer = layers.length
      if (!layers[lastLayer]) layers[lastLayer] = []
      layers[lastLayer].push(node.id)
    }
  })

  return layers.filter((layer) => layer.length > 0)
}

/**
 * Minimize edge crossings within layers using barycentric method
 */
function minimizeCrossings(
  layers: string[][],
  edges: Edge[],
  blocks: Record<string, BlockState>
): string[][] {
  if (layers.length <= 1) return layers

  const orderedLayers = layers.map((layer) => [...layer])

  // Create edge lookup for efficiency
  const edgeMap = new Map<string, Set<string>>()
  edges.forEach((edge) => {
    if (!edgeMap.has(edge.source)) edgeMap.set(edge.source, new Set())
    edgeMap.get(edge.source)!.add(edge.target)
  })

  // Multiple passes to improve ordering
  for (let pass = 0; pass < 3; pass++) {
    // Forward pass
    for (let i = 1; i < orderedLayers.length; i++) {
      orderedLayers[i] = orderLayerByBarycenter(
        orderedLayers[i],
        orderedLayers[i - 1],
        edgeMap,
        'incoming'
      )
    }

    // Backward pass
    for (let i = orderedLayers.length - 2; i >= 0; i--) {
      orderedLayers[i] = orderLayerByBarycenter(
        orderedLayers[i],
        orderedLayers[i + 1],
        edgeMap,
        'outgoing'
      )
    }
  }

  return orderedLayers
}

/**
 * Order nodes in a layer based on barycentric method
 */
function orderLayerByBarycenter(
  layer: string[],
  referenceLayer: string[],
  edgeMap: Map<string, Set<string>>,
  direction: 'incoming' | 'outgoing'
): string[] {
  const positions = new Map<string, number>()
  referenceLayer.forEach((nodeId, index) => {
    positions.set(nodeId, index)
  })

  const barycenters = layer.map((nodeId) => {
    const connections: number[] = []

    if (direction === 'incoming') {
      // Look at incoming edges from reference layer
      referenceLayer.forEach((refNodeId) => {
        if (edgeMap.get(refNodeId)?.has(nodeId)) {
          connections.push(positions.get(refNodeId) || 0)
        }
      })
    } else {
      // Look at outgoing edges to reference layer
      if (edgeMap.has(nodeId)) {
        edgeMap.get(nodeId)!.forEach((targetId) => {
          if (positions.has(targetId)) {
            connections.push(positions.get(targetId) || 0)
          }
        })
      }
    }

    const barycenter =
      connections.length > 0
        ? connections.reduce((sum, pos) => sum + pos, 0) / connections.length
        : positions.size / 2 // Default to middle if no connections

    return { nodeId, barycenter }
  })

  // Sort by barycenter
  barycenters.sort((a, b) => a.barycenter - b.barycenter)

  return barycenters.map((item) => item.nodeId)
}

/**
 * Calculate actual positions for blocks based on their dimensions
 */
function calculateBlockPositions(
  layers: string[][],
  blocks: Record<string, BlockState>,
  edges: Edge[],
  direction: 'horizontal' | 'vertical',
  options: {
    strategy: 'smart' | 'hierarchical' | 'layered' | 'force-directed'
    direction: 'horizontal' | 'vertical' | 'auto'
    spacing: {
      horizontal: number
      vertical: number
      layer: number
    }
    alignment: 'start' | 'center' | 'end'
    padding: {
      x: number
      y: number
    }
  }
): Record<string, BlockState> {
  const layoutedBlocks: Record<string, BlockState> = {}
  const isHorizontal = direction === 'horizontal'

  // Default block dimensions
  const DEFAULT_WIDTH = 360
  const DEFAULT_HEIGHT = 180
  const WIDE_WIDTH = 720
  const CONTAINER_PADDING = 100

  // Calculate dimensions for each block
  const blockDimensions = new Map<string, { width: number; height: number }>()

  Object.entries(blocks).forEach(([blockId, block]) => {
    let width = DEFAULT_WIDTH
    let height = DEFAULT_HEIGHT

    // Check for wide blocks
    if (block.isWide) {
      width = WIDE_WIDTH
    }

    // Check for custom dimensions in data
    if (block.data?.width) {
      width = block.data.width
    }
    if (block.data?.height) {
      height = block.data.height
    }

    // Use stored height if available
    if (block.height && block.height > 0) {
      height = block.height
    }

    // Container nodes (loops, parallels) need extra space
    if (block.type === 'loop' || block.type === 'parallel') {
      // Check if this container has children
      const hasChildren = Object.values(blocks).some((b) => b.data?.parentId === blockId)
      if (hasChildren) {
        width = Math.max(width, WIDE_WIDTH + CONTAINER_PADDING * 2)
        height = Math.max(height, DEFAULT_HEIGHT + CONTAINER_PADDING * 2)
      }
    }

    blockDimensions.set(blockId, { width, height })
  })

  // Calculate layer positions
  const layerPositions: { x: number; y: number }[] = []
  let currentPos = isHorizontal ? options.padding.x : options.padding.y

  layers.forEach((layer, layerIndex) => {
    // Find max dimension in layer for alignment
    let maxCrossSize = 0
    layer.forEach((blockId) => {
      const dim = blockDimensions.get(blockId)!
      const crossSize = isHorizontal ? dim.width : dim.height
      maxCrossSize = Math.max(maxCrossSize, crossSize)
    })

    layerPositions.push({
      x: isHorizontal ? currentPos : options.padding.x,
      y: isHorizontal ? options.padding.y : currentPos,
    })

    // Move to next layer position
    const layerSpacing = options.spacing.layer
    currentPos += maxCrossSize + layerSpacing
  })

  // Position blocks within each layer
  layers.forEach((layer, layerIndex) => {
    const layerPos = layerPositions[layerIndex]
    let currentCrossPos = isHorizontal ? layerPos.y : layerPos.x

    // Calculate total size needed for layer
    let totalSize = 0
    const sizes: number[] = []

    layer.forEach((blockId) => {
      const dim = blockDimensions.get(blockId)!
      const size = isHorizontal ? dim.height : dim.width
      sizes.push(size)
      totalSize += size
    })

    // Add spacing between blocks
    const spacing = isHorizontal ? options.spacing.vertical : options.spacing.horizontal
    totalSize += spacing * (layer.length - 1)

    // Center the layer
    if (options.alignment === 'center') {
      const viewportSize = isHorizontal ? 2000 : 2000 // Approximate viewport
      currentCrossPos = (viewportSize - totalSize) / 2
    }

    // Position each block in the layer
    layer.forEach((blockId, index) => {
      const block = blocks[blockId]
      const dim = blockDimensions.get(blockId)!

      const position: Position = {
        x: isHorizontal ? layerPos.x : currentCrossPos,
        y: isHorizontal ? currentCrossPos : layerPos.y,
      }

      // Store the layouted block
      layoutedBlocks[blockId] = {
        ...block,
        position,
      }

      // Move to next position
      const size = isHorizontal ? dim.height : dim.width
      currentCrossPos += size + spacing
    })
  })

  // Handle container node children positioning
  Object.entries(layoutedBlocks).forEach(([blockId, block]) => {
    if (block.data?.parentId) {
      const parent = layoutedBlocks[block.data.parentId]
      if (parent) {
        // Adjust child position relative to parent with padding
        const padding = 50
        block.position = {
          x: parent.position.x + padding,
          y: parent.position.y + padding + 50, // Extra top padding for container header
        }
      }
    }
  })

  return layoutedBlocks
}

/**
 * Apply LOCAL auto layout and update the workflow store immediately
 * This uses the in-repository layout algorithm instead of external API
 */
export async function applyLocalAutoLayoutAndUpdateStore(
  workflowId: string,
  options: AutoLayoutOptions = {}
): Promise<{
  success: boolean
  error?: string
}> {
  try {
    // Import workflow store
    const { useWorkflowStore } = await import('@/stores/workflows/workflow/store')

    const workflowStore = useWorkflowStore.getState()
    const { blocks, edges, loops = {}, parallels = {} } = workflowStore

    logger.info('Local auto layout store data:', {
      workflowId,
      blockCount: Object.keys(blocks).length,
      edgeCount: edges.length,
      loopCount: Object.keys(loops).length,
      parallelCount: Object.keys(parallels).length,
    })

    if (Object.keys(blocks).length === 0) {
      logger.warn('No blocks to layout', { workflowId })
      return { success: false, error: 'No blocks to layout' }
    }

    // Apply LOCAL auto layout
    const result = await applyLocalAutoLayout(workflowId, blocks, edges, loops, parallels, options)

    if (!result.success || !result.layoutedBlocks) {
      return { success: false, error: result.error }
    }

    // Update workflow store immediately with new positions
    const newWorkflowState = {
      ...workflowStore.getWorkflowState(),
      blocks: result.layoutedBlocks,
      lastSaved: Date.now(),
    }

    useWorkflowStore.setState(newWorkflowState)

    logger.info('Successfully updated workflow store with local auto layout', { workflowId })

    // Persist the changes to the database optimistically
    try {
      // Update the lastSaved timestamp in the store
      useWorkflowStore.getState().updateLastSaved()

      // Clean up the workflow state for API validation
      const cleanedWorkflowState = {
        ...newWorkflowState,
        // Convert null dates to undefined (since they're optional)
        deployedAt: newWorkflowState.deployedAt ? new Date(newWorkflowState.deployedAt) : undefined,
        // Ensure other optional fields are properly handled
        loops: newWorkflowState.loops || {},
        parallels: newWorkflowState.parallels || {},
        deploymentStatuses: newWorkflowState.deploymentStatuses || {},
      }

      // Save the updated workflow state to the database
      const response = await fetch(`/api/workflows/${workflowId}/state`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(cleanedWorkflowState),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`)
      }

      logger.info('Local auto layout successfully persisted to database', { workflowId })
      return { success: true }
    } catch (saveError) {
      logger.error('Failed to save local auto layout to database, reverting store changes:', {
        workflowId,
        error: saveError,
      })

      // Revert the store changes since database save failed
      useWorkflowStore.setState({
        ...workflowStore.getWorkflowState(),
        blocks: blocks, // Revert to original blocks
        lastSaved: workflowStore.lastSaved, // Revert lastSaved
      })

      return {
        success: false,
        error: `Failed to save positions to database: ${saveError instanceof Error ? saveError.message : 'Unknown error'}`,
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown store update error'
    logger.error('Failed to update store with local auto layout:', {
      workflowId,
      error: errorMessage,
    })

    return {
      success: false,
      error: errorMessage,
    }
  }
}
