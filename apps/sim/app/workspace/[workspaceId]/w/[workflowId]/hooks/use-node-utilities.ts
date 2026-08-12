import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS } from '@sim/workflow-renderer'
import { useReactFlow } from 'reactflow'
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
   * A block's dimensions as reported during this session, or null if nothing
   * has reported them yet.
   *
   * Reads `layout`, not `height`. `layout` is in-memory only — a card writes it
   * through `updateBlockLayoutMetrics` once it knows what it renders, and a
   * container through `updateNodeDimensions` once it has been sized from its
   * children. `height` is a persisted column, so it can still hold last
   * session's value for a block that has not reported yet, and `data.width` /
   * `data.height` likewise persist a container's last size. Sizing a container
   * from those is the same guess-then-correct this gate exists to prevent, just
   * closer to the truth and harder to reproduce.
   *
   * Reading `layout` also settles nesting: an inner container that is still
   * waiting on its own children has nothing in `layout`, so it reports null and
   * the outer container waits with it, rather than sizing to the inner one's
   * default and resizing again once it fills out.
   */
  const getReportedBlockDimensions = useCallback(
    (blockId: string): { width: number; height: number } | null => {
      const block = blocks[blockId]
      const reportedHeight = block?.layout?.measuredHeight
      if (!block || !reportedHeight) return null

      if (isContainerType(block.type)) {
        return {
          width: Math.max(
            block.layout?.measuredWidth || CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
            CONTAINER_DIMENSIONS.MIN_WIDTH
          ),
          height: Math.max(reportedHeight, CONTAINER_DIMENSIONS.MIN_HEIGHT),
        }
      }

      return {
        width: block.type === 'note' ? BLOCK_DIMENSIONS.NOTE_WIDTH : BLOCK_DIMENSIONS.FIXED_WIDTH,
        height:
          block.type === 'note'
            ? reportedHeight
            : Math.max(reportedHeight, BLOCK_DIMENSIONS.MIN_HEIGHT),
      }
    },
    [blocks, isContainerType]
  )

  /**
   * Get the dimensions of a block, falling back to its persisted height and
   * then to an estimate from its type.
   *
   * The callers here only need a rough box — clamping a drag, placing a paste —
   * so a stale height beats a guess and a guess beats nothing. A container
   * sizing itself cannot use either; see {@link calculateLoopDimensions}.
   */
  const getBlockDimensions = useCallback(
    (blockId: string): { width: number; height: number } => {
      const reported = getReportedBlockDimensions(blockId)
      if (reported) return reported

      const block = blocks[blockId]
      if (!block) {
        return { width: BLOCK_DIMENSIONS.FIXED_WIDTH, height: BLOCK_DIMENSIONS.MIN_HEIGHT }
      }

      if (isContainerType(block.type)) {
        return {
          width: Math.max(
            block.data?.width || CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
            CONTAINER_DIMENSIONS.MIN_WIDTH
          ),
          height: Math.max(
            block.data?.height || CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
            CONTAINER_DIMENSIONS.MIN_HEIGHT
          ),
        }
      }

      if (block.height) {
        return {
          width: block.type === 'note' ? BLOCK_DIMENSIONS.NOTE_WIDTH : BLOCK_DIMENSIONS.FIXED_WIDTH,
          height:
            block.type === 'note'
              ? block.height
              : Math.max(block.height, BLOCK_DIMENSIONS.MIN_HEIGHT),
        }
      }

      return estimateBlockDimensions(block.type)
    },
    [blocks, isContainerType, getReportedBlockDimensions]
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
    (nodeId: string, maxDepth = 100): string[] => {
      const node = getNodes().find((n) => n.id === nodeId)
      if (!node || maxDepth <= 0) return [nodeId]
      const parentId = blocks?.[nodeId]?.data?.parentId
      if (!parentId) return [nodeId]
      return [...getNodeHierarchy(parentId, maxDepth - 1), nodeId]
    },
    [getNodes, blocks]
  )

  /**
   * Returns true if nodeId is in the subtree of ancestorId (i.e. walking from nodeId
   * up the parentId chain we reach ancestorId). Used to reject parent assignments that
   * would create a cycle (e.g. setting dragged node's parent to a container inside it).
   *
   * @param ancestorId - Node that might be an ancestor
   * @param nodeId - Node to walk from (upward)
   * @returns True if ancestorId appears in the parent chain of nodeId
   */
  const isDescendantOf = useCallback(
    (ancestorId: string, nodeId: string): boolean => {
      const visited = new Set<string>()
      const maxDepth = 100
      let currentId: string | undefined = nodeId
      let depth = 0
      while (currentId && depth < maxDepth) {
        if (currentId === ancestorId) return true
        if (visited.has(currentId)) return false
        visited.add(currentId)
        currentId = blocks?.[currentId]?.data?.parentId
        depth += 1
      }
      return false
    },
    [blocks]
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
   *
   * Sizes only from heights the children have themselves reported. A card's
   * height depends on what it actually renders — which rows survive its
   * conditions, whether it draws a summary sentence, and for a reactive field
   * even a credential it has to fetch — so the card is the only thing that can
   * know it, and it publishes it once it does.
   *
   * Guessing in the meantime is what made a container resize on every load:
   * `estimateBlockDimensions` assumes `ceil(subBlockCount / 2)` rows, so it read
   * a 39-field Gmail card as 276px tall against the 112px it draws. The
   * container painted that, then the real height arrived a frame later and it
   * visibly resized. Returning null holds the container at the size it already
   * has, so it moves once, to the right answer.
   *
   * @param nodeId ID of the container node
   * @returns Calculated dimensions, or null while any child is still unmeasured
   */
  const calculateLoopDimensions = useCallback(
    (nodeId: string): { width: number; height: number } | null => {
      const currentBlocks = useWorkflowStore.getState().blocks
      const childBlockIds = Object.keys(currentBlocks).filter(
        (id) => currentBlocks[id]?.data?.parentId === nodeId
      )

      const childPositions: Array<{ x: number; y: number; width: number; height: number }> = []
      for (const childId of childBlockIds) {
        const child = currentBlocks[childId]
        if (!child?.position) continue

        const reported = getReportedBlockDimensions(childId)
        if (!reported) return null

        childPositions.push({ x: child.position.x, y: child.position.y, ...reported })
      }

      return calculateContainerDimensions(childPositions)
    },
    [getReportedBlockDimensions]
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
        if (!dimensions) continue

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
    isDescendantOf,
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
