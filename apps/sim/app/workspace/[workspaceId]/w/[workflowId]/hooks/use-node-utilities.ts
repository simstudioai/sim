import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import { useReactFlow } from 'reactflow'
import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS } from '@/lib/workflows/blocks/block-dimensions'
import { getBlock } from '@/blocks/registry'

const logger = createLogger('NodeUtilities')

/**
 * Estimates block dimensions based on block type.
 * Uses subblock count to estimate height for blocks that haven't been measured yet.
 *
 * @param blockType - The type of block (e.g., 'condition', 'agent')
 * @returns Estimated width and height for the block
 */
export function estimateBlockDimensions(blockType: string): { width: number; height: number } {
  const blockConfig = getBlock(blockType)
  const subBlockCount = blockConfig?.subBlocks?.length ?? 3
  // Many subblocks are conditionally rendered (advanced mode, provider-specific, etc.)
  // Use roughly half the config count as a reasonable estimate, capped between 3-7 rows
  const estimatedRows = Math.max(3, Math.min(Math.ceil(subBlockCount / 2), 7))
  const hasErrorRow = blockType !== 'starter' && blockType !== 'response' ? 1 : 0

  const height =
    BLOCK_DIMENSIONS.HEADER_HEIGHT +
    BLOCK_DIMENSIONS.WORKFLOW_CONTENT_PADDING +
    (estimatedRows + hasErrorRow) * BLOCK_DIMENSIONS.WORKFLOW_ROW_HEIGHT

  return {
    width: BLOCK_DIMENSIONS.FIXED_WIDTH,
    height: Math.max(height, BLOCK_DIMENSIONS.MIN_HEIGHT),
  }
}

/**
 * Clamps a position to keep a block fully inside a container's content area.
 * Content area starts after the header and padding, and ends before the right/bottom padding.
 *
 * @param position - Raw position relative to container origin
 * @param containerDimensions - Container width and height
 * @param blockDimensions - Block width and height
 * @returns Clamped position that keeps block inside content area
 */
export function clampPositionToContainer(
  position: { x: number; y: number },
  containerDimensions: { width: number; height: number },
  blockDimensions: { width: number; height: number }
): { x: number; y: number } {
  const { width: containerWidth, height: containerHeight } = containerDimensions
  const { width: blockWidth, height: blockHeight } = blockDimensions

  // Content area bounds (where blocks can be placed)
  const minX = CONTAINER_DIMENSIONS.LEFT_PADDING
  const minY = CONTAINER_DIMENSIONS.HEADER_HEIGHT + CONTAINER_DIMENSIONS.TOP_PADDING
  const maxX = containerWidth - CONTAINER_DIMENSIONS.RIGHT_PADDING - blockWidth
  const maxY = containerHeight - CONTAINER_DIMENSIONS.BOTTOM_PADDING - blockHeight

  return {
    x: Math.max(minX, Math.min(position.x, Math.max(minX, maxX))),
    y: Math.max(minY, Math.min(position.y, Math.max(minY, maxY))),
  }
}

/**
 * Hook providing utilities for node position, hierarchy, and dimension calculations
 */
export function useNodeUtilities(blocks: Record<string, any>) {
  const { getNodes } = useReactFlow()

  /**
   * Check if a block is a container type (loop, parallel, or subflow)
   */
  const isContainerType = useCallback((blockType: string): boolean => {
    return blockType === 'loop' || blockType === 'parallel' || blockType === 'subflowNode'
  }, [])

  /**
   * Get the dimensions of a block.
   * For regular blocks, uses stored height or estimates based on block config.
   */
  const getBlockDimensions = useCallback(
    (blockId: string): { width: number; height: number } => {
      const block = blocks[blockId]
      if (!block) {
        return { width: BLOCK_DIMENSIONS.FIXED_WIDTH, height: BLOCK_DIMENSIONS.MIN_HEIGHT }
      }

      if (isContainerType(block.type)) {
        return {
          width: block.data?.width
            ? Math.max(block.data.width, CONTAINER_DIMENSIONS.MIN_WIDTH)
            : CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
          height: block.data?.height
            ? Math.max(block.data.height, CONTAINER_DIMENSIONS.MIN_HEIGHT)
            : CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
        }
      }

      // Prefer deterministic height published by the block component; fallback to estimate
      if (block.height) {
        return {
          width: BLOCK_DIMENSIONS.FIXED_WIDTH,
          height: Math.max(block.height, BLOCK_DIMENSIONS.MIN_HEIGHT),
        }
      }

      // Use shared estimation utility for blocks without measured height
      return estimateBlockDimensions(block.type)
    },
    [blocks, isContainerType]
  )

  /**
   * Calculates the depth of a node in the hierarchy tree
   * @param nodeId ID of the node to check
   * @param maxDepth Maximum depth to prevent stack overflow
   * @returns Depth level (0 for root nodes, increasing for nested nodes)
   */
  const getNodeDepth = useCallback(
    (nodeId: string, maxDepth = 100): number => {
      const node = getNodes().find((n) => n.id === nodeId)
      if (!node || maxDepth <= 0) return 0
      const parentId = blocks?.[nodeId]?.data?.parentId
      if (!parentId) return 0
      return 1 + getNodeDepth(parentId, maxDepth - 1)
    },
    [getNodes, blocks]
  )

  /**
   * Gets the full hierarchy path of a node (its parent chain)
   * @param nodeId ID of the node to check
   * @returns Array of node IDs representing the hierarchy path
   */
  const getNodeHierarchy = useCallback(
    (nodeId: string): string[] => {
      const node = getNodes().find((n) => n.id === nodeId)
      if (!node) return [nodeId]
      const parentId = blocks?.[nodeId]?.data?.parentId
      if (!parentId) return [nodeId]
      return [...getNodeHierarchy(parentId), nodeId]
    },
    [getNodes, blocks]
  )

  /**
   * Gets the absolute position of a node (accounting for nested parents).
   * For nodes inside containers, accounts for header and padding offsets.
   * @param nodeId ID of the node to check
   * @returns Absolute position coordinates {x, y}
   */
  const getNodeAbsolutePosition = useCallback(
    (nodeId: string): { x: number; y: number } => {
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

      const parentPos = getNodeAbsolutePosition(parentId)

      // Child positions are stored relative to the content area (after header and padding)
      // Add these offsets when calculating absolute position
      const headerHeight = 50
      const leftPadding = 16
      const topPadding = 16

      return {
        x: parentPos.x + leftPadding + node.position.x,
        y: parentPos.y + headerHeight + topPadding + node.position.y,
      }
    },
    [getNodes, blocks]
  )

  /**
   * Calculates the relative position of a node to a new parent's origin.
   * React Flow positions children relative to parent origin, so we clamp
   * to the content area bounds (after header and padding).
   * @param nodeId ID of the node being repositioned
   * @param newParentId ID of the new parent
   * @returns Relative position coordinates {x, y} within the parent
   */
  const calculateRelativePosition = useCallback(
    (nodeId: string, newParentId: string): { x: number; y: number } => {
      const nodeAbsPos = getNodeAbsolutePosition(nodeId)
      const parentAbsPos = getNodeAbsolutePosition(newParentId)
      const parentNode = getNodes().find((n) => n.id === newParentId)

      // Calculate raw relative position (relative to parent origin)
      const rawPosition = {
        x: nodeAbsPos.x - parentAbsPos.x,
        y: nodeAbsPos.y - parentAbsPos.y,
      }

      // Get container and block dimensions
      const containerDimensions = {
        width: parentNode?.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
        height: parentNode?.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
      }
      const blockDimensions = getBlockDimensions(nodeId)

      // Clamp position to keep block inside content area
      return clampPositionToContainer(rawPosition, containerDimensions, blockDimensions)
    },
    [getNodeAbsolutePosition, getNodes, getBlockDimensions]
  )

  /**
   * Checks if a point is inside a loop or parallel node
   * @param position Position coordinates to check
   * @returns The smallest container node containing the point, or null if none
   */
  const isPointInLoopNode = useCallback(
    (position: {
      x: number
      y: number
    }): {
      loopId: string
      loopPosition: { x: number; y: number }
      dimensions: { width: number; height: number }
    } | null => {
      const containingNodes = getNodes()
        .filter((n) => n.type && isContainerType(n.type))
        .filter((n) => {
          // Use absolute coordinates for nested containers
          const absolutePos = getNodeAbsolutePosition(n.id)
          const rect = {
            left: absolutePos.x,
            right: absolutePos.x + (n.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH),
            top: absolutePos.y,
            bottom: absolutePos.y + (n.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT),
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
          loopPosition: getNodeAbsolutePosition(n.id),
          dimensions: {
            width: n.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
            height: n.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
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
    },
    [getNodes, isContainerType, getNodeAbsolutePosition]
  )

  /**
   * Calculates appropriate dimensions for a loop or parallel node based on its children
   * @param nodeId ID of the container node
   * @returns Calculated width and height for the container
   */
  const calculateLoopDimensions = useCallback(
    (nodeId: string): { width: number; height: number } => {
      // Check both React Flow's node.parentId AND blocks store's data.parentId
      // This ensures we catch children even if React Flow hasn't re-rendered yet
      const childNodes = getNodes().filter(
        (node) => node.parentId === nodeId || blocks[node.id]?.data?.parentId === nodeId
      )
      if (childNodes.length === 0) {
        return {
          width: CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
          height: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
        }
      }

      let maxRight = 0
      let maxBottom = 0

      childNodes.forEach((node) => {
        const { width: nodeWidth, height: nodeHeight } = getBlockDimensions(node.id)
        // Use block position from store if available (more up-to-date)
        const block = blocks[node.id]
        const position = block?.position || node.position
        maxRight = Math.max(maxRight, position.x + nodeWidth)
        maxBottom = Math.max(maxBottom, position.y + nodeHeight)
      })

      const width = Math.max(
        CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
        CONTAINER_DIMENSIONS.LEFT_PADDING + maxRight + CONTAINER_DIMENSIONS.RIGHT_PADDING
      )
      const height = Math.max(
        CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
        CONTAINER_DIMENSIONS.HEADER_HEIGHT +
          CONTAINER_DIMENSIONS.TOP_PADDING +
          maxBottom +
          CONTAINER_DIMENSIONS.BOTTOM_PADDING
      )

      return { width, height }
    },
    [getNodes, getBlockDimensions, blocks]
  )

  /**
   * Resizes all loop and parallel nodes based on their children
   * @param updateNodeDimensions Function to update the dimensions of a node
   */
  const resizeLoopNodes = useCallback(
    (updateNodeDimensions: (id: string, dimensions: { width: number; height: number }) => void) => {
      const containerNodes = getNodes()
        .filter((node) => node.type && isContainerType(node.type))
        .map((node) => ({
          ...node,
          depth: getNodeDepth(node.id),
        }))
        // Sort by depth descending - process innermost containers first
        // so their dimensions are correct when outer containers calculate sizes
        .sort((a, b) => b.depth - a.depth)

      containerNodes.forEach((node) => {
        const dimensions = calculateLoopDimensions(node.id)
        // Get current dimensions from the blocks store rather than React Flow's potentially stale state
        const currentWidth = blocks[node.id]?.data?.width
        const currentHeight = blocks[node.id]?.data?.height

        // Only update if dimensions actually changed to avoid unnecessary re-renders
        if (dimensions.width !== currentWidth || dimensions.height !== currentHeight) {
          updateNodeDimensions(node.id, dimensions)
        }
      })
    },
    [getNodes, isContainerType, getNodeDepth, calculateLoopDimensions, blocks]
  )

  /**
   * Updates a node's parent with proper position calculation
   * @param nodeId ID of the node being reparented
   * @param newParentId ID of the new parent (or null to remove parent)
   * @param updateBlockPosition Function to update the position of a block
   * @param updateParentId Function to update the parent ID of a block
   * @param resizeCallback Function to resize loop nodes after parent update
   */
  const updateNodeParent = useCallback(
    (
      nodeId: string,
      newParentId: string | null,
      updateBlockPosition: (id: string, position: { x: number; y: number }) => void,
      updateParentId: (id: string, parentId: string, extent: 'parent') => void,
      resizeCallback: () => void
    ) => {
      const node = getNodes().find((n) => n.id === nodeId)
      if (!node) return

      const currentParentId = blocks[nodeId]?.data?.parentId || null
      if (newParentId === currentParentId) return

      if (newParentId) {
        const relativePosition = calculateRelativePosition(nodeId, newParentId)

        updateBlockPosition(nodeId, relativePosition)
        updateParentId(nodeId, newParentId, 'parent')
      } else if (currentParentId) {
        const absolutePosition = getNodeAbsolutePosition(nodeId)

        // First set the absolute position so the node visually stays in place
        updateBlockPosition(nodeId, absolutePosition)
        // Then clear the parent relationship in the store (empty string removes parentId/extent)
        updateParentId(nodeId, '', 'parent')
      }

      resizeCallback()
    },
    [getNodes, blocks, calculateRelativePosition, getNodeAbsolutePosition]
  )

  /**
   * Compute the absolute position of a node's source anchor (right-middle)
   * @param nodeId ID of the node
   * @returns Absolute position of the source anchor
   */
  const getNodeAnchorPosition = useCallback(
    (nodeId: string): { x: number; y: number } => {
      const node = getNodes().find((n) => n.id === nodeId)
      const absPos = getNodeAbsolutePosition(nodeId)

      if (!node) {
        return absPos
      }

      // Use known defaults per node type without type casting
      const isSubflow = node.type === 'subflowNode'
      const width = isSubflow
        ? typeof node.data?.width === 'number'
          ? node.data.width
          : 500
        : typeof node.width === 'number'
          ? node.width
          : 250
      const height = isSubflow
        ? typeof node.data?.height === 'number'
          ? node.data.height
          : 300
        : typeof node.height === 'number'
          ? node.height
          : 100

      return {
        x: absPos.x + width,
        y: absPos.y + height / 2,
      }
    },
    [getNodes, getNodeAbsolutePosition]
  )

  return {
    getNodeDepth,
    getNodeHierarchy,
    getNodeAbsolutePosition,
    calculateRelativePosition,
    isPointInLoopNode,
    calculateLoopDimensions,
    resizeLoopNodes,
    updateNodeParent,
    getNodeAnchorPosition,
    isContainerType,
    getBlockDimensions,
  }
}
