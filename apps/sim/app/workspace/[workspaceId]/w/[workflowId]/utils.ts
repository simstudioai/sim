import { createLogger } from '@/lib/logs/console/logger'
import { getBlock } from '@/blocks'

const logger = createLogger('WorkflowUtils')

const DEFAULT_CONTAINER_WIDTH = 500
const DEFAULT_CONTAINER_HEIGHT = 300

/**
 * Check if a block is a container type
 */
const isContainerType = (blockType: string): boolean => {
  return (
    blockType === 'loop' ||
    blockType === 'parallel' ||
    blockType === 'loopNode' ||
    blockType === 'parallelNode' ||
    blockType === 'subflowNode'
  )
}

/**
 * Get the priority score of a block
 */
const getBlockPriorityScore = (
  blockId: string,
  orphanedBlocks: Set<string>,
  disabledBlocks: Set<string>,
  terminalBlocks: Set<string>
): number => {
  if (orphanedBlocks.has(blockId)) return 3
  if (disabledBlocks.has(blockId)) return 2
  if (terminalBlocks.has(blockId)) return 1
  return 0
}

/**
 * Group nodes by their parent relationships
 */
const groupNodesByParents = (
  nodes: string[],
  edges: any[],
  blocks: Record<string, any>,
  keyPrefix = ''
): Map<string, string[]> => {
  const parentGroups = new Map<string, string[]>()

  nodes.forEach((nodeId) => {
    const parents: string[] = []
    edges.forEach((edge) => {
      if (edge.target === nodeId && blocks[edge.source]) {
        parents.push(edge.source)
      }
    })

    const parentKey = parents.sort().join(',') || `${keyPrefix}no-parent`

    if (!parentGroups.has(parentKey)) {
      parentGroups.set(parentKey, [])
    }
    parentGroups.get(parentKey)!.push(nodeId)
  })

  return parentGroups
}

/**
 * Sort blocks by priority
 */
const sortBlocksByPriority = (
  blocks: string[],
  orphanedBlocks: Set<string>,
  disabledBlocks: Set<string>,
  terminalBlocks: Set<string>
): string[] => {
  return [...blocks].sort((a, b) => {
    const aScore = getBlockPriorityScore(a, orphanedBlocks, disabledBlocks, terminalBlocks)
    const bScore = getBlockPriorityScore(b, orphanedBlocks, disabledBlocks, terminalBlocks)
    if (aScore !== bScore) return aScore - bScore
    return a.localeCompare(b)
  })
}

/**
 * Get the dimensions of a block
 */
const getBlockDimensions = (
  blocks: Record<string, any>,
  blockId: string
): { width: number; height: number } => {
  const block = blocks[blockId]
  if (!block) return { width: 350, height: 150 }

  if (isContainerType(block.type)) {
    return {
      width: block.data?.width ? Math.max(block.data.width, 400) : DEFAULT_CONTAINER_WIDTH,
      height: block.data?.height ? Math.max(block.data.height, 200) : DEFAULT_CONTAINER_HEIGHT,
    }
  }

  return {
    width: block.layout?.measuredWidth || (block.isWide ? 450 : block.data?.width || 350),
    height: Math.max(
      block.layout?.measuredHeight || block.height || block.data?.height || 150,
      100
    ),
  }
}

/**
 * Calculates the depth of a node in the hierarchy tree
 * @param nodeId ID of the node to check
 * @param getNodes Function to retrieve all nodes from ReactFlow
 * @param maxDepth Maximum depth to prevent stack overflow
 * @returns Depth level (0 for root nodes, increasing for nested nodes)
 */
export const getNodeDepth = (
  nodeId: string,
  getNodes: () => any[],
  blocks?: Record<string, any>,
  maxDepth = 100
): number => {
  const node = getNodes().find((n) => n.id === nodeId)
  if (!node || maxDepth <= 0) return 0
  const parentId = blocks?.[nodeId]?.data?.parentId
  if (!parentId) return 0
  return 1 + getNodeDepth(parentId, getNodes, blocks, maxDepth - 1)
}

/**
 * Gets the full hierarchy path of a node (its parent chain)
 * @param nodeId ID of the node to check
 * @param getNodes Function to retrieve all nodes from ReactFlow
 * @returns Array of node IDs representing the hierarchy path
 */
export const getNodeHierarchy = (
  nodeId: string,
  getNodes: () => any[],
  blocks?: Record<string, any>
): string[] => {
  const node = getNodes().find((n) => n.id === nodeId)
  if (!node) return [nodeId]
  const parentId = blocks?.[nodeId]?.data?.parentId
  if (!parentId) return [nodeId]
  return [...getNodeHierarchy(parentId, getNodes, blocks), nodeId]
}

/**
 * Gets the absolute position of a node (accounting for nested parents)
 * @param nodeId ID of the node to check
 * @param getNodes Function to retrieve all nodes from ReactFlow
 * @returns Absolute position coordinates {x, y}
 */
export const getNodeAbsolutePosition = (
  nodeId: string,
  getNodes: () => any[],
  blocks?: Record<string, any>
): { x: number; y: number } => {
  const node = getNodes().find((n) => n.id === nodeId)
  if (!node) {
    logger.warn('Attempted to get position of non-existent node', { nodeId })
    return { x: 0, y: 0 }
  }

  const parentId = blocks?.[nodeId]?.data?.parentId
  if (!parentId) {
    return node.position
  }

  const parentNode = getNodes().find((n) => n.id === parentId)
  if (!parentNode) {
    logger.warn('Node references non-existent parent', {
      nodeId,
      invalidParentId: parentId,
    })
    return node.position
  }

  const visited = new Set<string>()
  let currentId = nodeId
  while (currentId && blocks?.[currentId]?.data?.parentId) {
    const currentParentId = blocks[currentId].data.parentId
    if (visited.has(currentParentId)) {
      logger.error('Circular parent reference detected', {
        nodeId,
        parentChain: Array.from(visited),
      })
      return node.position
    }
    visited.add(currentId)
    currentId = currentParentId
  }

  const parentPos = getNodeAbsolutePosition(parentId, getNodes, blocks)

  return {
    x: parentPos.x + node.position.x,
    y: parentPos.y + node.position.y,
  }
}

/**
 * Calculates the relative position of a node to a new parent
 * @param nodeId ID of the node being repositioned
 * @param newParentId ID of the new parent
 * @param getNodes Function to retrieve all nodes from ReactFlow
 * @returns Relative position coordinates {x, y}
 */
export const calculateRelativePosition = (
  nodeId: string,
  newParentId: string,
  getNodes: () => any[],
  blocks?: Record<string, any>
): { x: number; y: number } => {
  const nodeAbsPos = getNodeAbsolutePosition(nodeId, getNodes, blocks)

  const parentAbsPos = getNodeAbsolutePosition(newParentId, getNodes, blocks)

  return {
    x: nodeAbsPos.x - parentAbsPos.x,
    y: nodeAbsPos.y - parentAbsPos.y,
  }
}

/**
 * Updates a node's parent with proper position calculation
 * @param nodeId ID of the node being reparented
 * @param newParentId ID of the new parent (or null to remove parent)
 * @param getNodes Function to retrieve all nodes from ReactFlow
 * @param updateBlockPosition Function to update the position of a block
 * @param updateParentId Function to update the parent ID of a block
 * @param resizeLoopNodes Function to resize loop nodes after parent update
 */
export const updateNodeParent = (
  nodeId: string,
  newParentId: string | null,
  getNodes: () => any[],
  blocks: Record<string, any>,
  updateBlockPosition: (id: string, position: { x: number; y: number }) => void,
  updateParentId: (id: string, parentId: string, extent: 'parent') => void,
  resizeLoopNodes: () => void
) => {
  const node = getNodes().find((n) => n.id === nodeId)
  if (!node) return

  const currentParentId = blocks[nodeId]?.data?.parentId || null
  if (newParentId === currentParentId) return

  if (newParentId) {
    const relativePosition = calculateRelativePosition(nodeId, newParentId, getNodes, blocks)

    updateBlockPosition(nodeId, relativePosition)
    updateParentId(nodeId, newParentId, 'parent')
  } else if (currentParentId) {
    const absolutePosition = getNodeAbsolutePosition(nodeId, getNodes, blocks)

    // First set the absolute position so the node visually stays in place
    updateBlockPosition(nodeId, absolutePosition)
    // Then clear the parent relationship in the store (empty string removes parentId/extent)
    updateParentId(nodeId, '', 'parent')
  }

  resizeLoopNodes()
}

/**
 * Checks if a point is inside a loop or parallel node
 * @param position Position coordinates to check
 * @param getNodes Function to retrieve all nodes from ReactFlow
 * @returns The smallest container node containing the point, or null if none
 */
export const isPointInLoopNode = (
  position: { x: number; y: number },
  getNodes: () => any[],
  blocks?: Record<string, any>
): {
  loopId: string
  loopPosition: { x: number; y: number }
  dimensions: { width: number; height: number }
} | null => {
  const containingNodes = getNodes()
    .filter((n) => isContainerType(n.type))
    .filter((n) => {
      // Use absolute coordinates for nested containers
      const absolutePos = getNodeAbsolutePosition(n.id, getNodes, blocks)
      const rect = {
        left: absolutePos.x,
        right: absolutePos.x + (n.data?.width || DEFAULT_CONTAINER_WIDTH),
        top: absolutePos.y,
        bottom: absolutePos.y + (n.data?.height || DEFAULT_CONTAINER_HEIGHT),
      }

      return (
        position.x >= rect.left &&
        position.x <= rect.right &&
        position.y >= rect.top &&
        position.y <= rect.bottom
      )
    })
    .map((n) => ({
      loopId: n.id,
      // Return absolute position so callers can compute relative placement correctly
      loopPosition: getNodeAbsolutePosition(n.id, getNodes, blocks),
      dimensions: {
        width: n.data?.width || DEFAULT_CONTAINER_WIDTH,
        height: n.data?.height || DEFAULT_CONTAINER_HEIGHT,
      },
    }))

  if (containingNodes.length > 0) {
    return containingNodes.sort((a, b) => {
      const aArea = a.dimensions.width * a.dimensions.height
      const bArea = b.dimensions.width * b.dimensions.height
      return aArea - bArea
    })[0]
  }

  return null
}

/**
 * Calculates appropriate dimensions for a loop or parallel node based on its children
 * @param nodeId ID of the container node
 * @param getNodes Function to retrieve all nodes from ReactFlow
 * @param blocks Block states from workflow store
 * @returns Calculated width and height for the container
 */
export const calculateLoopDimensions = (
  nodeId: string,
  getNodes: () => any[],
  blocks: Record<string, any>
): { width: number; height: number } => {
  const minWidth = DEFAULT_CONTAINER_WIDTH
  const minHeight = DEFAULT_CONTAINER_HEIGHT

  const childNodes = getNodes().filter((node) => node.parentId === nodeId)
  if (childNodes.length === 0) {
    return { width: minWidth, height: minHeight }
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  childNodes.forEach((node) => {
    const { width: nodeWidth, height: nodeHeight } = getBlockDimensions(blocks, node.id)

    minX = Math.min(minX, node.position.x + nodeWidth)
    minY = Math.min(minY, node.position.y + nodeHeight)
    maxX = Math.max(maxX, node.position.x + nodeWidth)
    maxY = Math.max(maxY, node.position.y + nodeHeight + 50)
  })

  const hasNestedContainers = childNodes.some((node) => isContainerType(node.type))

  const sidePadding = hasNestedContainers ? 150 : 120

  const extraPadding = 50

  const width = Math.max(minWidth, maxX + sidePadding + extraPadding)
  const height = Math.max(minHeight, maxY + sidePadding)

  return { width, height }
}

/**
 * Resizes all loop and parallel nodes based on their children
 * @param getNodes Function to retrieve all nodes from ReactFlow
 * @param updateNodeDimensions Function to update the dimensions of a node
 * @param blocks Block states from workflow store
 */
export const resizeLoopNodes = (
  getNodes: () => any[],
  updateNodeDimensions: (id: string, dimensions: { width: number; height: number }) => void,
  blocks: Record<string, any>
) => {
  const containerNodes = getNodes()
    .filter((node) => isContainerType(node.type))
    .map((node) => ({
      ...node,
      depth: getNodeDepth(node.id, getNodes, blocks),
    }))
    .sort((a, b) => a.depth - b.depth)

  containerNodes.forEach((node) => {
    const dimensions = calculateLoopDimensions(node.id, getNodes, blocks)

    if (dimensions.width !== node.data?.width || dimensions.height !== node.data?.height) {
      updateNodeDimensions(node.id, dimensions)
    }
  })
}

/**
 * Analyzes the workflow graph using topological sort to determine execution layers
 * and properly handle parallel execution paths, disabled blocks, and terminal blocks
 * @param blocks Block states from workflow store
 * @param edges Edge connections from workflow store
 * @returns Map of block IDs to their layer numbers and additional graph data
 */
export const analyzeWorkflowGraph = (
  blocks: Record<string, any>,
  edges: any[]
): {
  layers: Map<string, number>
  parallelGroups: Map<number, string[][]>
  maxLayer: number
  disabledBlocks: Set<string>
  terminalBlocks: Set<string>
  orphanedBlocks: Set<string>
} => {
  const blockLayers = new Map<string, number>()
  const inDegree = new Map<string, number>()
  const adjacencyList = new Map<string, string[]>()
  const disabledBlocks = new Set<string>()
  const terminalBlocks = new Set<string>()
  const orphanedBlocks = new Set<string>()

  Object.entries(blocks).forEach(([blockId, block]) => {
    inDegree.set(blockId, 0)
    adjacencyList.set(blockId, [])

    if (block.enabled === false) {
      disabledBlocks.add(blockId)
    }
  })

  edges.forEach((edge) => {
    if (edge.source && edge.target && blocks[edge.source] && blocks[edge.target]) {
      const neighbors = adjacencyList.get(edge.source) || []
      neighbors.push(edge.target)
      adjacencyList.set(edge.source, neighbors)
      inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1)
    }
  })

  Object.keys(blocks).forEach((blockId) => {
    const neighbors = adjacencyList.get(blockId) || []
    const block = blocks[blockId]

    if (neighbors.length === 0 && !isContainerType(block.type)) {
      terminalBlocks.add(blockId)
    }
  })

  Object.keys(blocks).forEach((blockId) => {
    const inDegreeValue = inDegree.get(blockId) || 0
    const outDegreeValue = (adjacencyList.get(blockId) || []).length
    const block = blocks[blockId]

    const blockConfig = getBlock(block.type)
    const isTriggerBlock = blockConfig?.category === 'triggers'

    if (
      inDegreeValue === 0 &&
      outDegreeValue === 0 &&
      block.type !== 'starter' &&
      !isTriggerBlock
    ) {
      orphanedBlocks.add(blockId)
    }
  })

  const queue: string[] = []
  inDegree.forEach((degree, blockId) => {
    const blockConfig = getBlock(blocks[blockId].type)
    const isTriggerBlock = blockConfig?.category === 'triggers'

    if (degree === 0 || blocks[blockId].type === 'starter' || isTriggerBlock) {
      queue.push(blockId)
      blockLayers.set(blockId, 0)
    }
  })

  const visited = new Set<string>()
  let maxLayer = 0

  while (queue.length > 0) {
    const currentId = queue.shift()!
    visited.add(currentId)

    const currentLayer = blockLayers.get(currentId) || 0
    maxLayer = Math.max(maxLayer, currentLayer)

    const neighbors = adjacencyList.get(currentId) || []
    neighbors.forEach((neighborId) => {
      const existingLayer = blockLayers.get(neighborId) || 0
      blockLayers.set(neighborId, Math.max(existingLayer, currentLayer + 1))

      const newInDegree = (inDegree.get(neighborId) || 1) - 1
      inDegree.set(neighborId, newInDegree)

      if (newInDegree === 0 && !visited.has(neighborId)) {
        queue.push(neighborId)
      }
    })
  }

  Object.keys(blocks).forEach((blockId) => {
    if (!blockLayers.has(blockId)) {
      if (orphanedBlocks.has(blockId)) {
        blockLayers.set(blockId, maxLayer + 2)
      } else {
        blockLayers.set(blockId, 0)
      }
    }
  })

  blockLayers.forEach((layer) => {
    maxLayer = Math.max(maxLayer, layer)
  })

  const parallelGroups = new Map<number, string[][]>()
  const layerNodes = new Map<number, string[]>()

  blockLayers.forEach((layer, blockId) => {
    if (!layerNodes.has(layer)) {
      layerNodes.set(layer, [])
    }
    layerNodes.get(layer)!.push(blockId)
  })

  layerNodes.forEach((nodes, layer) => {
    if (nodes.length === 1) {
      parallelGroups.set(layer, [[nodes[0]]])
    } else {
      const disabledNodesInLayer = nodes.filter((nodeId) => disabledBlocks.has(nodeId))
      const terminalNodesInLayer = nodes.filter((nodeId) => terminalBlocks.has(nodeId))
      const orphanedNodesInLayer = nodes.filter((nodeId) => orphanedBlocks.has(nodeId))
      const regularNodes = nodes.filter(
        (nodeId) =>
          !disabledBlocks.has(nodeId) && !terminalBlocks.has(nodeId) && !orphanedBlocks.has(nodeId)
      )

      const regularParentGroups = groupNodesByParents(regularNodes, edges, blocks)
      const groups = Array.from(regularParentGroups.values())

      if (disabledNodesInLayer.length > 0) {
        const disabledParentGroups = groupNodesByParents(
          disabledNodesInLayer,
          edges,
          blocks,
          'disabled-'
        )
        groups.push(...Array.from(disabledParentGroups.values()))
      }

      if (terminalNodesInLayer.length > 0) {
        groups.push(terminalNodesInLayer)
      }

      if (orphanedNodesInLayer.length > 0) {
        groups.push(orphanedNodesInLayer)
      }

      parallelGroups.set(layer, groups)
    }
  })

  return {
    layers: blockLayers,
    parallelGroups,
    maxLayer,
    disabledBlocks,
    terminalBlocks,
    orphanedBlocks,
  }
}

export interface LayoutOptions {
  horizontalSpacing?: number
  verticalSpacing?: number
  startX?: number
  startY?: number
  alignByLayer?: boolean
  handleOrientation?: 'auto' | 'horizontal' | 'vertical'
}

/**
 * Detects the predominant handle orientation in the workflow
 * @param blocks Block states from workflow store
 * @returns 'horizontal' if most blocks use horizontal handles, 'vertical' otherwise
 */
export const detectHandleOrientation = (blocks: Record<string, any>): 'horizontal' | 'vertical' => {
  const topLevelBlocks = Object.values(blocks).filter((block) => !block.data?.parentId)

  if (topLevelBlocks.length === 0) {
    return 'horizontal'
  }

  let horizontalCount = 0
  let verticalCount = 0

  topLevelBlocks.forEach((block) => {
    if (block.horizontalHandles === true) {
      horizontalCount++
    } else if (block.horizontalHandles === false) {
      verticalCount++
    } else {
      horizontalCount++
    }
  })

  return horizontalCount >= verticalCount ? 'horizontal' : 'vertical'
}

/**
 * NOTE: Auto layout functions have been moved to the centralized backend system
 * at apps/sim/lib/autolayout/ - all auto layout now goes through the API routes
 * and uses the same improved algorithm for consistent results.
 */
