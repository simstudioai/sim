import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import { useReactFlow } from 'reactflow'
import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS } from '@/lib/workflows/blocks/block-dimensions'
import {
  calculateContainerDimensions,
  clampPositionToContainer,
  estimateBlockDimensions,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/node-position-utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('NodeUtilities')

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

      if (block.height) {
        return {
          width: BLOCK_DIMENSIONS.FIXED_WIDTH,
          height: Math.max(block.height, BLOCK_DIMENSIONS.MIN_HEIGHT),
        }
      }

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
   * @param skipClamping If true, returns raw relative position without clamping to container bounds
   * @returns Relative position coordinates {x, y} within the parent
   */
  const calculateRelativePosition = useCallback(
    (nodeId: string, newParentId: string, skipClamping?: boolean): { x: number; y: number } => {
      const nodeAbsPos = getNodeAbsolutePosition(nodeId)
      const parentAbsPos = getNodeAbsolutePosition(newParentId)

      const rawPosition = {
        x: nodeAbsPos.x - parentAbsPos.x,
        y: nodeAbsPos.y - parentAbsPos.y,
      }

      if (skipClamping) {
        return rawPosition
      }

      const parentNode = getNodes().find((n) => n.id === newParentId)
      const containerDimensions = {
        width: parentNode?.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
        height: parentNode?.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
      }
      const blockDimensions = getBlockDimensions(nodeId)

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
      const currentBlocks = useWorkflowStore.getState().blocks
      const childBlockIds = Object.keys(currentBlocks).filter(
        (id) => currentBlocks[id]?.data?.parentId === nodeId
      )

      const childPositions = childBlockIds
        .map((childId) => {
          const child = currentBlocks[childId]
          if (!child?.position) return null
          const { width, height } = getBlockDimensions(childId)
          return { x: child.position.x, y: child.position.y, width, height }
        })
        .filter((p): p is NonNullable<typeof p> => p !== null)

      return calculateContainerDimensions(childPositions)
    },
    [getBlockDimensions]
  )

  /**
   * Resizes all loop and parallel nodes based on their children
   * @param updateNodeDimensions Function to update the dimensions of a node
   */
  const resizeLoopNodes = useCallback(
    (updateNodeDimensions: (id: string, dimensions: { width: number; height: number }) => void) => {
      const currentBlocks = useWorkflowStore.getState().blocks
      const containerBlocks = Object.entries(currentBlocks)
        .filter(([, block]) => block?.type && isContainerType(block.type))
        .map(([id, block]) => ({
          id,
          block,
          depth: getNodeDepth(id),
        }))
        .sort((a, b) => b.depth - a.depth)

      for (const { id, block } of containerBlocks) {
        const dimensions = calculateLoopDimensions(id)
        const currentWidth = block?.data?.width
        const currentHeight = block?.data?.height

        if (dimensions.width !== currentWidth || dimensions.height !== currentHeight) {
          updateNodeDimensions(id, dimensions)
        }
      }
    },
    [isContainerType, getNodeDepth, calculateLoopDimensions]
  )

  /**
   * Updates a node's parent with proper position calculation
   * @param nodeId ID of the node being reparented
   * @param newParentId ID of the new parent (or null to remove parent)
   * @param batchUpdatePositions Function to batch update positions of blocks
   * @param batchUpdateBlocksWithParent Function to batch update blocks with parent info
   * @param resizeCallback Function to resize loop nodes after parent update
   */
  const updateNodeParent = useCallback(
    (
      nodeId: string,
      newParentId: string | null,
      batchUpdatePositions: (
        updates: Array<{ id: string; position: { x: number; y: number } }>
      ) => void,
      batchUpdateBlocksWithParent: (
        updates: Array<{ id: string; position: { x: number; y: number }; parentId?: string }>
      ) => void,
      resizeCallback: () => void
    ) => {
      const node = getNodes().find((n) => n.id === nodeId)
      if (!node) return

      const currentParentId = blocks[nodeId]?.data?.parentId || null
      if (newParentId === currentParentId) return

      if (newParentId) {
        const relativePosition = calculateRelativePosition(nodeId, newParentId)

        batchUpdatePositions([{ id: nodeId, position: relativePosition }])
        batchUpdateBlocksWithParent([
          { id: nodeId, position: relativePosition, parentId: newParentId },
        ])
      } else if (currentParentId) {
        const absolutePosition = getNodeAbsolutePosition(nodeId)

        batchUpdatePositions([{ id: nodeId, position: absolutePosition }])
        batchUpdateBlocksWithParent([{ id: nodeId, position: absolutePosition, parentId: '' }])
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
