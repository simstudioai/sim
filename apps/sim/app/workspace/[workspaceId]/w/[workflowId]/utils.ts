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
    blockType === 'parallelNode'
  )
}

/**
 * Check if a block is a container block
 */
const isContainerBlock = (blocks: Record<string, any>, blockId: string): boolean => {
  const block = blocks[blockId]
  return block && isContainerType(block.type)
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
 * Get the type of a block
 */
const getBlockType = (
  blockId: string,
  orphanedBlocks: Set<string>,
  disabledBlocks: Set<string>,
  terminalBlocks: Set<string>
): 'orphaned' | 'disabled' | 'terminal' | 'regular' => {
  if (orphanedBlocks.has(blockId)) return 'orphaned'
  if (disabledBlocks.has(blockId)) return 'disabled'
  if (terminalBlocks.has(blockId)) return 'terminal'
  return 'regular'
}

/**
 * Calculate extra spacing between blocks of different types
 */
const calculateExtraSpacing = (
  currentBlockType: string,
  nextBlockType: string,
  baseSpacing: number,
  multiplier = 0.3
): number => {
  return currentBlockType !== nextBlockType ? baseSpacing * multiplier : 0
}

/**
 * Calculate the dimensions of a group of blocks
 */
const calculateGroupDimensions = (
  group: string[],
  orphanedBlocks: Set<string>,
  disabledBlocks: Set<string>,
  terminalBlocks: Set<string>,
  blocks: Record<string, any>,
  spacing: number,
  getDimension: (blocks: Record<string, any>, blockId: string) => number
): number => {
  const sortedGroup = sortBlocksByPriority(group, orphanedBlocks, disabledBlocks, terminalBlocks)

  let totalDimension = 0
  sortedGroup.forEach((nodeId, index) => {
    const blockDimension = getDimension(blocks, nodeId)
    totalDimension += blockDimension

    if (index < sortedGroup.length - 1) {
      const currentBlockType = getBlockType(nodeId, orphanedBlocks, disabledBlocks, terminalBlocks)
      const nextBlockType = getBlockType(
        sortedGroup[index + 1],
        orphanedBlocks,
        disabledBlocks,
        terminalBlocks
      )
      const extraSpacing = calculateExtraSpacing(currentBlockType, nextBlockType, spacing)
      totalDimension += spacing * 0.5 + extraSpacing
    }
  })

  return totalDimension
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

  if (block.type === 'workflowBlock') {
    const nodeWidth = block.data?.width || block.width
    const nodeHeight = block.data?.height || block.height

    if (nodeWidth && nodeHeight) {
      return { width: nodeWidth, height: nodeHeight }
    }
  }

  return {
    width: block.isWide ? 450 : block.data?.width || block.width || 350,
    height: Math.max(block.height || block.data?.height || 150, 100),
  }
}

/**
 * Get the height of a block
 */
const getBlockHeight = (blocks: Record<string, any>, blockId: string): number => {
  return getBlockDimensions(blocks, blockId).height
}

/**
 * Get the width of a block
 */
const getBlockWidth = (blocks: Record<string, any>, blockId: string): number => {
  return getBlockDimensions(blocks, blockId).width
}

/**
 * Calculates the depth of a node in the hierarchy tree
 * @param nodeId ID of the node to check
 * @param getNodes Function to retrieve all nodes from ReactFlow
 * @param maxDepth Maximum depth to prevent stack overflow
 * @returns Depth level (0 for root nodes, increasing for nested nodes)
 */
export const getNodeDepth = (nodeId: string, getNodes: () => any[], maxDepth = 100): number => {
  const node = getNodes().find((n) => n.id === nodeId)
  if (!node || !node.parentId || maxDepth <= 0) return 0
  return 1 + getNodeDepth(node.parentId, getNodes, maxDepth - 1)
}

/**
 * Gets the full hierarchy path of a node (its parent chain)
 * @param nodeId ID of the node to check
 * @param getNodes Function to retrieve all nodes from ReactFlow
 * @returns Array of node IDs representing the hierarchy path
 */
export const getNodeHierarchy = (nodeId: string, getNodes: () => any[]): string[] => {
  const node = getNodes().find((n) => n.id === nodeId)
  if (!node || !node.parentId) return [nodeId]
  return [...getNodeHierarchy(node.parentId, getNodes), nodeId]
}

/**
 * Gets the absolute position of a node (accounting for nested parents)
 * @param nodeId ID of the node to check
 * @param getNodes Function to retrieve all nodes from ReactFlow
 * @returns Absolute position coordinates {x, y}
 */
export const getNodeAbsolutePosition = (
  nodeId: string,
  getNodes: () => any[]
): { x: number; y: number } => {
  const node = getNodes().find((n) => n.id === nodeId)
  if (!node) {
    logger.warn('Attempted to get position of non-existent node', { nodeId })
    return { x: 0, y: 0 }
  }

  if (!node.parentId) {
    return node.position
  }

  const parentNode = getNodes().find((n) => n.id === node.parentId)
  if (!parentNode) {
    logger.warn('Node references non-existent parent', {
      nodeId,
      invalidParentId: node.parentId,
    })
    return node.position
  }

  const visited = new Set<string>()
  let current: any = node
  while (current?.parentId) {
    if (visited.has(current.parentId)) {
      logger.error('Circular parent reference detected', {
        nodeId,
        parentChain: Array.from(visited),
      })
      return node.position
    }
    visited.add(current.id)
    current = getNodes().find((n) => n.id === current.parentId)
  }

  const parentPos = getNodeAbsolutePosition(node.parentId, getNodes)

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
  getNodes: () => any[]
): { x: number; y: number } => {
  const nodeAbsPos = getNodeAbsolutePosition(nodeId, getNodes)

  const parentAbsPos = getNodeAbsolutePosition(newParentId, getNodes)

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
  updateBlockPosition: (id: string, position: { x: number; y: number }) => void,
  updateParentId: (id: string, parentId: string, extent: 'parent') => void,
  resizeLoopNodes: () => void
) => {
  const node = getNodes().find((n) => n.id === nodeId)
  if (!node) return

  const currentParentId = node.parentId || null
  if (newParentId === currentParentId) return

  if (newParentId) {
    const relativePosition = calculateRelativePosition(nodeId, newParentId, getNodes)

    updateBlockPosition(nodeId, relativePosition)
    updateParentId(nodeId, newParentId, 'parent')
  } else if (currentParentId) {
    const absolutePosition = getNodeAbsolutePosition(nodeId, getNodes)

    updateBlockPosition(nodeId, absolutePosition)
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
  getNodes: () => any[]
): {
  loopId: string
  loopPosition: { x: number; y: number }
  dimensions: { width: number; height: number }
} | null => {
  const containingNodes = getNodes()
    .filter((n) => isContainerType(n.type))
    .filter((n) => {
      const rect = {
        left: n.position.x,
        right: n.position.x + (n.data?.width || DEFAULT_CONTAINER_WIDTH),
        top: n.position.y,
        bottom: n.position.y + (n.data?.height || DEFAULT_CONTAINER_HEIGHT),
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
      loopPosition: n.position,
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
      depth: getNodeDepth(node.id, getNodes),
    }))
    .sort((a, b) => a.depth - b.depth)

  containerNodes.forEach((node) => {
    const dimensions = calculateLoopDimensions(node.id, getNodes, blocks)

    if (dimensions.width !== node.data?.width || dimensions.height !== node.data?.height) {
      updateNodeDimensions(node.id, dimensions)
    }
  })
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

/**
 * Calculates auto-layout positions for workflow blocks with improved spacing and alignment
 * Enhanced to handle both horizontal and vertical handle orientations
 * @param blocks Block states from workflow store
 * @param edges Edge connections from workflow store
 * @param options Layout configuration options
 * @returns Map of block IDs to their new positions
 */
export const calculateAutoLayout = (
  blocks: Record<string, any>,
  edges: any[],
  options: LayoutOptions = {}
): Map<string, { x: number; y: number }> => {
  const {
    horizontalSpacing = 600,
    verticalSpacing = 200,
    startX = 300,
    startY = 300,
    alignByLayer = true,
    handleOrientation = 'auto',
  } = options

  const newPositions = new Map<string, { x: number; y: number }>()

  const topLevelBlocks = Object.fromEntries(
    Object.entries(blocks).filter(([_, block]) => !block.data?.parentId)
  )

  if (Object.keys(topLevelBlocks).length === 0) {
    return newPositions
  }

  let actualOrientation: 'horizontal' | 'vertical'
  if (handleOrientation === 'auto') {
    actualOrientation = detectHandleOrientation(blocks)
  } else {
    actualOrientation = handleOrientation
  }

  if (alignByLayer) {
    const { parallelGroups, maxLayer, disabledBlocks, terminalBlocks, orphanedBlocks } =
      analyzeWorkflowGraph(topLevelBlocks, edges)

    if (actualOrientation === 'horizontal') {
      const calculateLayerSpacing = (currentLayer: number, nextLayer: number): number => {
        const currentLayerGroups = parallelGroups.get(currentLayer) || []
        const nextLayerGroups = parallelGroups.get(nextLayer) || []

        let maxCurrentWidth = 0
        currentLayerGroups.forEach((group: string[]) => {
          group.forEach((nodeId: string) => {
            maxCurrentWidth = Math.max(maxCurrentWidth, getBlockWidth(blocks, nodeId))
          })
        })

        let maxNextWidth = 0
        nextLayerGroups.forEach((group: string[]) => {
          group.forEach((nodeId: string) => {
            maxNextWidth = Math.max(maxNextWidth, getBlockWidth(blocks, nodeId))
          })
        })

        const baseSpacing = horizontalSpacing
        const widthAdjustment = Math.max(maxCurrentWidth, maxNextWidth) - 350 // 350 is standard width
        const connectionTagSpace = 100

        const isOrphanedLayer =
          currentLayer > maxLayer - 2 &&
          (currentLayerGroups.some((group) => group.some((nodeId) => orphanedBlocks.has(nodeId))) ||
            nextLayerGroups.some((group) => group.some((nodeId) => orphanedBlocks.has(nodeId))))
        const orphanedSpacing = isOrphanedLayer ? 200 : 0

        return baseSpacing + widthAdjustment + connectionTagSpace + orphanedSpacing
      }

      let currentLayerX = startX

      for (let layer = 0; layer <= maxLayer; layer++) {
        const groups = parallelGroups.get(layer) || []

        let totalHeight = 0
        const groupHeights: number[] = []

        groups.forEach((group) => {
          const groupHeight = calculateGroupDimensions(
            group,
            orphanedBlocks,
            disabledBlocks,
            terminalBlocks,
            blocks,
            verticalSpacing,
            getBlockHeight
          )
          groupHeights.push(groupHeight)
          totalHeight += groupHeight
        })

        if (groups.length > 1) {
          totalHeight += (groups.length - 1) * verticalSpacing
        }

        let currentY = startY - totalHeight / 2

        groups.forEach((group, groupIndex) => {
          const sortedGroup = sortBlocksByPriority(
            group,
            orphanedBlocks,
            disabledBlocks,
            terminalBlocks
          )

          sortedGroup.forEach((nodeId, nodeIndex) => {
            const blockHeight = getBlockHeight(blocks, nodeId)

            let positionY = currentY
            if (isContainerBlock(blocks, nodeId)) {
              positionY = currentY
            }

            newPositions.set(nodeId, {
              x: currentLayerX,
              y: positionY,
            })

            currentY += blockHeight

            if (nodeIndex < sortedGroup.length - 1) {
              const currentBlockType = getBlockType(
                nodeId,
                orphanedBlocks,
                disabledBlocks,
                terminalBlocks
              )
              const nextBlockType = getBlockType(
                sortedGroup[nodeIndex + 1],
                orphanedBlocks,
                disabledBlocks,
                terminalBlocks
              )

              const extraSpacing = calculateExtraSpacing(
                currentBlockType,
                nextBlockType,
                verticalSpacing
              )
              currentY += verticalSpacing * 0.5 + extraSpacing
            }
          })

          if (groupIndex < groups.length - 1) {
            currentY += verticalSpacing
          }
        })

        if (layer < maxLayer) {
          const dynamicSpacing = calculateLayerSpacing(layer, layer + 1)
          currentLayerX += dynamicSpacing
        }
      }
    } else {
      const calculateLayerSpacing = (currentLayer: number, nextLayer: number): number => {
        const currentLayerGroups = parallelGroups.get(currentLayer) || []
        const nextLayerGroups = parallelGroups.get(nextLayer) || []

        let maxCurrentHeight = 0
        currentLayerGroups.forEach((group: string[]) => {
          group.forEach((nodeId: string) => {
            maxCurrentHeight = Math.max(maxCurrentHeight, getBlockHeight(blocks, nodeId))
          })
        })

        let maxNextHeight = 0
        nextLayerGroups.forEach((group: string[]) => {
          group.forEach((nodeId: string) => {
            maxNextHeight = Math.max(maxNextHeight, getBlockHeight(blocks, nodeId))
          })
        })

        const baseSpacing = verticalSpacing
        const heightAdjustment = Math.max(maxCurrentHeight, maxNextHeight) - 150 // 150 is standard height
        const connectionTagSpace = 50

        const isOrphanedLayer =
          currentLayer > maxLayer - 2 &&
          (currentLayerGroups.some((group) => group.some((nodeId) => orphanedBlocks.has(nodeId))) ||
            nextLayerGroups.some((group) => group.some((nodeId) => orphanedBlocks.has(nodeId))))
        const orphanedSpacing = isOrphanedLayer ? 150 : 0

        return baseSpacing + heightAdjustment + connectionTagSpace + orphanedSpacing
      }

      let currentLayerY = startY

      for (let layer = 0; layer <= maxLayer; layer++) {
        const groups = parallelGroups.get(layer) || []

        let totalWidth = 0
        const groupWidths: number[] = []

        groups.forEach((group) => {
          const groupWidth = calculateGroupDimensions(
            group,
            orphanedBlocks,
            disabledBlocks,
            terminalBlocks,
            blocks,
            horizontalSpacing,
            getBlockWidth
          )
          groupWidths.push(groupWidth)
          totalWidth += groupWidth
        })

        if (groups.length > 1) {
          totalWidth += (groups.length - 1) * horizontalSpacing
        }

        let currentX = startX - totalWidth / 2

        groups.forEach((group, groupIndex) => {
          const sortedGroup = sortBlocksByPriority(
            group,
            orphanedBlocks,
            disabledBlocks,
            terminalBlocks
          )

          sortedGroup.forEach((nodeId, nodeIndex) => {
            const blockWidth = getBlockWidth(blocks, nodeId)

            let positionX = currentX
            if (isContainerBlock(blocks, nodeId)) {
              positionX = currentX
            }

            newPositions.set(nodeId, {
              x: positionX,
              y: currentLayerY,
            })

            currentX += blockWidth

            if (nodeIndex < sortedGroup.length - 1) {
              const currentBlockType = getBlockType(
                nodeId,
                orphanedBlocks,
                disabledBlocks,
                terminalBlocks
              )
              const nextBlockType = getBlockType(
                sortedGroup[nodeIndex + 1],
                orphanedBlocks,
                disabledBlocks,
                terminalBlocks
              )

              const extraSpacing = calculateExtraSpacing(
                currentBlockType,
                nextBlockType,
                horizontalSpacing
              )
              currentX += horizontalSpacing * 0.5 + extraSpacing
            }
          })

          if (groupIndex < groups.length - 1) {
            currentX += horizontalSpacing
          }
        })

        if (layer < maxLayer) {
          const dynamicSpacing = calculateLayerSpacing(layer, layer + 1)
          currentLayerY += dynamicSpacing
        }
      }
    }
  } else {
    const blockIds = Object.keys(topLevelBlocks)

    if (actualOrientation === 'horizontal') {
      let currentX = startX

      blockIds.forEach((blockId, index) => {
        newPositions.set(blockId, { x: currentX, y: startY })

        if (index < blockIds.length - 1) {
          const blockWidth = getBlockWidth(blocks, blockId)
          const nextBlockWidth = getBlockWidth(blocks, blockIds[index + 1])
          const spacing = horizontalSpacing + Math.max(blockWidth, nextBlockWidth) - 350
          currentX += spacing
        }
      })
    } else {
      let currentY = startY

      blockIds.forEach((blockId, index) => {
        newPositions.set(blockId, { x: startX, y: currentY })

        if (index < blockIds.length - 1) {
          const blockHeight = getBlockHeight(blocks, blockId)
          const nextBlockHeight = getBlockHeight(blocks, blockIds[index + 1])
          const spacing = verticalSpacing + Math.max(blockHeight, nextBlockHeight) - 150
          currentY += spacing
        }
      })
    }
  }

  return newPositions
}

/**
 * Enhanced auto-layout function with smooth animations
 * @param blocks Block states from workflow store
 * @param edges Edge connections from workflow store
 * @param updateBlockPosition Function to update block positions
 * @param fitView Function to fit the view
 * @param resizeLoopNodes Function to resize loop nodes
 * @param options Layout configuration options
 */
export const applyAutoLayoutSmooth = (
  blocks: Record<string, any>,
  edges: any[],
  updateBlockPosition: (id: string, position: { x: number; y: number }) => void,
  fitView: (options?: { padding?: number; duration?: number }) => void,
  resizeLoopNodes: () => void,
  options: LayoutOptions & {
    animationDuration?: number
    isSidebarCollapsed?: boolean
    onComplete?: (finalPositions: Map<string, { x: number; y: number }>) => void
  } = {}
): void => {
  const {
    animationDuration = 500,
    isSidebarCollapsed = false,
    onComplete,
    ...layoutOptions
  } = options

  if (!layoutOptions.handleOrientation || layoutOptions.handleOrientation === 'auto') {
    layoutOptions.handleOrientation = detectHandleOrientation(blocks)
  }

  const topLevelPositions = calculateAutoLayout(blocks, edges, layoutOptions)

  const childPositions = new Map<string, { x: number; y: number }>()

  const containerBlocks = Object.entries(blocks).filter(
    ([_, block]) => isContainerType(block.type) && !block.data?.parentId
  )

  containerBlocks.forEach(([containerId]) => {
    const childBlocks = Object.fromEntries(
      Object.entries(blocks).filter(([_, block]) => block.data?.parentId === containerId)
    )

    if (Object.keys(childBlocks).length === 0) return

    const childEdges = edges.filter((edge) => childBlocks[edge.source] && childBlocks[edge.target])

    const childLayoutOptions: LayoutOptions = {
      horizontalSpacing: Math.min(300, layoutOptions.horizontalSpacing || 300),
      verticalSpacing: Math.min(150, layoutOptions.verticalSpacing || 150),
      startX: 50,
      startY: 80,
      alignByLayer: true,
      handleOrientation: layoutOptions.handleOrientation,
    }

    const childPositionsForContainer = calculateAutoLayout(
      childBlocks,
      childEdges,
      childLayoutOptions
    )

    childPositionsForContainer.forEach((position, blockId) => {
      childPositions.set(blockId, position)
    })
  })

  const allPositions = new Map([...topLevelPositions, ...childPositions])

  if (allPositions.size === 0) return

  const currentPositions = new Map<string, { x: number; y: number }>()
  allPositions.forEach((_, blockId) => {
    const block = blocks[blockId]
    if (block) {
      currentPositions.set(blockId, { x: block.position.x, y: block.position.y })
    }
  })

  const startTime = Date.now()
  const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3

  const animate = async () => {
    const elapsed = Date.now() - startTime
    const progress = Math.min(elapsed / animationDuration, 1)
    const easedProgress = easeOutCubic(progress)

    allPositions.forEach((targetPosition, blockId) => {
      const currentPosition = currentPositions.get(blockId)
      if (!currentPosition) return

      const newPosition = {
        x: currentPosition.x + (targetPosition.x - currentPosition.x) * easedProgress,
        y: currentPosition.y + (targetPosition.y - currentPosition.y) * easedProgress,
      }

      updateBlockPosition(blockId, newPosition)
    })

    if (progress < 1) {
      requestAnimationFrame(animate)
    } else {
      resizeLoopNodes()

      const padding = isSidebarCollapsed ? 0.35 : 0.55
      fitView({
        padding,
        duration: 400,
      })

      // Call completion callback with final positions
      if (onComplete) {
        onComplete(allPositions)
      }
    }
  }

  animate()
}

/**
 * Original auto-layout function (for backward compatibility)
 * @param blocks Block states from workflow store
 * @param edges Edge connections from workflow store
 * @param updateBlockPosition Function to update block positions
 * @param options Layout configuration options
 */
export const applyAutoLayout = (
  blocks: Record<string, any>,
  edges: any[],
  updateBlockPosition: (id: string, position: { x: number; y: number }) => void,
  options: LayoutOptions = {}
): void => {
  if (!options.handleOrientation || options.handleOrientation === 'auto') {
    options.handleOrientation = detectHandleOrientation(blocks)
  }

  const topLevelPositions = calculateAutoLayout(blocks, edges, options)

  topLevelPositions.forEach((position, blockId) => {
    updateBlockPosition(blockId, position)
  })

  const containerBlocks = Object.entries(blocks).filter(
    ([_, block]) => isContainerType(block.type) && !block.data?.parentId
  )

  containerBlocks.forEach(([containerId]) => {
    const childBlocks = Object.fromEntries(
      Object.entries(blocks).filter(([_, block]) => block.data?.parentId === containerId)
    )

    if (Object.keys(childBlocks).length === 0) return

    const childEdges = edges.filter((edge) => childBlocks[edge.source] && childBlocks[edge.target])

    const childLayoutOptions: LayoutOptions = {
      horizontalSpacing: Math.min(300, options.horizontalSpacing || 300),
      verticalSpacing: Math.min(150, options.verticalSpacing || 150),
      startX: 50,
      startY: 80,
      alignByLayer: true,
      handleOrientation: options.handleOrientation,
    }

    const childPositions = calculateAutoLayout(childBlocks, childEdges, childLayoutOptions)

    childPositions.forEach((position, blockId) => {
      updateBlockPosition(blockId, position)
    })
  })
}
