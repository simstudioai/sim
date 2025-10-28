import { useCallback } from 'react'
import { useReactFlow } from 'reactflow'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('NodeUtilities')

const DEFAULT_CONTAINER_WIDTH = 500
const DEFAULT_CONTAINER_HEIGHT = 300

/**
 * Hook providing utilities for node position, hierarchy, and dimension calculations
 */
export function useNodeUtilities(blocks: Record<string, any>) {
  const { getNodes, project } = useReactFlow()

  /**
   * Check if a block is a container type
   */
  const isContainerType = useCallback((blockType: string): boolean => {
    return (
      blockType === 'loop' ||
      blockType === 'parallel' ||
      blockType === 'loopNode' ||
      blockType === 'parallelNode' ||
      blockType === 'subflowNode'
    )
  }, [])

  /**
   * Get the dimensions of a block
   */
  const getBlockDimensions = useCallback(
    (blockId: string): { width: number; height: number } => {
      const block = blocks[blockId]
      if (!block) return { width: 350, height: 150 }

      if (isContainerType(block.type)) {
        return {
          width: block.data?.width ? Math.max(block.data.width, 400) : DEFAULT_CONTAINER_WIDTH,
          height: block.data?.height ? Math.max(block.data.height, 200) : DEFAULT_CONTAINER_HEIGHT,
        }
      }

      return {
        width: block.layout?.measuredWidth || block.data?.width || 350,
        height: Math.max(
          block.layout?.measuredHeight || block.height || block.data?.height || 150,
          100
        ),
      }
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
   * Gets the absolute position of a node (accounting for nested parents)
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

      return {
        x: parentPos.x + node.position.x,
        y: parentPos.y + node.position.y,
      }
    },
    [getNodes, blocks]
  )

  /**
   * Calculates the relative position of a node to a new parent
   * @param nodeId ID of the node being repositioned
   * @param newParentId ID of the new parent
   * @returns Relative position coordinates {x, y}
   */
  const calculateRelativePosition = useCallback(
    (nodeId: string, newParentId: string): { x: number; y: number } => {
      const nodeAbsPos = getNodeAbsolutePosition(nodeId)
      const parentAbsPos = getNodeAbsolutePosition(newParentId)

      return {
        x: nodeAbsPos.x - parentAbsPos.x,
        y: nodeAbsPos.y - parentAbsPos.y,
      }
    },
    [getNodeAbsolutePosition]
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
          loopPosition: getNodeAbsolutePosition(n.id),
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
        const { width: nodeWidth, height: nodeHeight } = getBlockDimensions(node.id)

        minX = Math.min(minX, node.position.x + nodeWidth)
        minY = Math.min(minY, node.position.y + nodeHeight)
        maxX = Math.max(maxX, node.position.x + nodeWidth)
        maxY = Math.max(maxY, node.position.y + nodeHeight + 50)
      })

      const hasNestedContainers = childNodes.some((node) => node.type && isContainerType(node.type))

      const sidePadding = hasNestedContainers ? 150 : 120

      const extraPadding = 50

      const width = Math.max(minWidth, maxX + sidePadding + extraPadding)
      const height = Math.max(minHeight, maxY + sidePadding)

      return { width, height }
    },
    [getNodes, getBlockDimensions, isContainerType]
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
        .sort((a, b) => a.depth - b.depth)

      containerNodes.forEach((node) => {
        const dimensions = calculateLoopDimensions(node.id)

        if (dimensions.width !== node.data?.width || dimensions.height !== node.data?.height) {
          updateNodeDimensions(node.id, dimensions)
        }
      })
    },
    [getNodes, isContainerType, getNodeDepth, calculateLoopDimensions]
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
          : 350
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
