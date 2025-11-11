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
   * Check if a block is a container type (loop, parallel, or subflow)
   */
  const isContainerType = useCallback((blockType: string): boolean => {
    return blockType === 'loop' || blockType === 'parallel' || blockType === 'subflowNode'
  }, [])

  /**
   * Get the dimensions of a block.
   * For regular blocks, estimates height if not yet measured by ResizeObserver.
   */
  const getBlockDimensions = useCallback(
    (blockId: string): { width: number; height: number } => {
      const block = blocks[blockId]
      if (!block) return { width: 250, height: 100 }

      if (isContainerType(block.type)) {
        return {
          width: block.data?.width ? Math.max(block.data.width, 400) : DEFAULT_CONTAINER_WIDTH,
          height: block.data?.height ? Math.max(block.data.height, 200) : DEFAULT_CONTAINER_HEIGHT,
        }
      }

      // Workflow block nodes have fixed visual width
      const width = 250

      // Prefer deterministic height published by the block component; fallback to estimate
      let height = block.height

      if (!height) {
        // Estimate height for workflow blocks before ResizeObserver measures them
        // Block structure: header (40px) + content area with subblocks
        // Each subblock row is approximately 29px (14px text + 8px gap + padding)
        const headerHeight = 40
        const subblockRowHeight = 29
        const contentPadding = 16 // p-[8px] top and bottom = 16px total

        // Estimate number of visible subblock rows
        // This is a rough estimate - actual rendering may vary
        const estimatedRows = 3 // Conservative estimate for typical blocks
        const hasErrorRow = block.type !== 'starter' && block.type !== 'response' ? 1 : 0

        height = headerHeight + contentPadding + (estimatedRows + hasErrorRow) * subblockRowHeight
      }

      return {
        width,
        height: Math.max(height, 100),
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
   * Calculates the relative position of a node to a new parent's content area.
   * Accounts for header height and padding offsets in container nodes.
   * @param nodeId ID of the node being repositioned
   * @param newParentId ID of the new parent
   * @returns Relative position coordinates {x, y} within the parent's content area
   */
  const calculateRelativePosition = useCallback(
    (nodeId: string, newParentId: string): { x: number; y: number } => {
      const nodeAbsPos = getNodeAbsolutePosition(nodeId)
      const parentAbsPos = getNodeAbsolutePosition(newParentId)

      // Account for container's header and padding
      // Children are positioned relative to content area, not container origin
      const headerHeight = 50
      const leftPadding = 16
      const topPadding = 16

      return {
        x: nodeAbsPos.x - parentAbsPos.x - leftPadding,
        y: nodeAbsPos.y - parentAbsPos.y - headerHeight - topPadding,
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

      // Match styling in subflow-node.tsx:
      // - Header section: 50px total height
      // - Content area: px-[16px] pb-[0px] pt-[16px] pr-[70px]
      //   Left padding: 16px, Right padding: 64px, Top padding: 16px, Bottom padding: -6px (reduced by additional 6px from 0 to achieve 14px total reduction from original 8px)
      // - Children are positioned relative to the content area (after header, inside padding)
      const headerHeight = 50
      const leftPadding = 16
      const rightPadding = 80
      const topPadding = 16
      const bottomPadding = 16

      const childNodes = getNodes().filter((node) => node.parentId === nodeId)
      if (childNodes.length === 0) {
        return { width: minWidth, height: minHeight }
      }

      let maxRight = 0
      let maxBottom = 0

      childNodes.forEach((node) => {
        const { width: nodeWidth, height: nodeHeight } = getBlockDimensions(node.id)

        // Child positions are relative to content area's inner top-left (inside padding)
        // Calculate the rightmost and bottommost edges of children
        const rightEdge = node.position.x + nodeWidth
        const bottomEdge = node.position.y + nodeHeight

        maxRight = Math.max(maxRight, rightEdge)
        maxBottom = Math.max(maxBottom, bottomEdge)
      })

      // Container dimensions = header + padding + children bounds + padding
      // Width: left padding + max child right edge + right padding (64px)
      const width = Math.max(minWidth, leftPadding + maxRight + rightPadding)
      // Height: header + top padding + max child bottom edge + bottom padding (8px)
      const height = Math.max(minHeight, headerHeight + topPadding + maxBottom + bottomPadding)

      return { width, height }
    },
    [getNodes, getBlockDimensions]
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
