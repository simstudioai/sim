import { useCallback } from 'react'
import { createLogger } from '@sim/logger'
import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS, getNoteBlockHeight } from '@sim/workflow-renderer'
import type { BlockState } from '@sim/workflow-types/workflow'
import { useReactFlow } from '@xyflow/react'
import { getBlockMetrics } from '@/lib/workflows/autolayout/utils'
import {
  calculateContainerDimensions,
  clampPositionToContainer,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/node-position-utils'
import { getNodeDataDimension } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils/workflow-canvas-helpers'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('NodeUtilities')

/**
 * Hook providing utilities for node position, hierarchy, and dimension calculations
 */
export function useNodeUtilities(blocks: Record<string, BlockState>) {
  const { getNodes } = useReactFlow()

  /**
   * Check if a block is a container type (loop, parallel, or subflow)
   */
  const isContainerType = useCallback((blockType: string): boolean => {
    return blockType === 'loop' || blockType === 'parallel' || blockType === 'subflowNode'
  }, [])

  /**
   * Get the dimensions of a block.
   *
   * Before a card mounts there is no measurement, so the height comes from
   * {@link getBlockMetrics}, which estimates it from the block's own state —
   * the sub-blocks its values leave visible, the summary sentence it will draw,
   * the error row — through the same `calculateWorkflowBlockDimensions` the
   * card itself calls. It lands on the height the card goes on to render.
   *
   * The old estimate read the block's *type* alone and assumed
   * `ceil(subBlockCount / 2)` rows, which put a 39-field Gmail card at 276px
   * against the 112px it draws. A container sized from that, painted it, then
   * got the real height a frame later and visibly resized — on every load,
   * because measurements are not persisted. Estimating from state removes the
   * gap rather than waiting it out: both passes now produce the same number.
   */
  const dimensionsOfBlock = useCallback(
    (block: any): { width: number; height: number } => {
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

      /* A note is not a card: it has no sub-block rows and no error row, so the
         card estimate does not describe it. Its own height is what it was
         measured at, or the height an empty one paints. */
      if (block.type === 'note') {
        return {
          width: BLOCK_DIMENSIONS.NOTE_WIDTH,
          height: block.height || getNoteBlockHeight(true),
        }
      }

      return getBlockMetrics(block)
    },
    [isContainerType]
  )

  const getBlockDimensions = useCallback(
    (blockId: string): { width: number; height: number } => dimensionsOfBlock(blocks[blockId]),
    [blocks, dimensionsOfBlock]
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
   * Gets the absolute position of a node, walking up its parent chain.
   *
   * A child's position is relative to its container's own origin — React Flow
   * places it at the parent's origin plus its position, and
   * `clampPositionToContainer` is what holds it clear of the chrome, flooring it
   * at `LEFT_PADDING` and `HEADER_HEIGHT + TOP_PADDING`. The container's header
   * and padding are therefore already inside the child's coordinates, and
   * adding them again here counted them twice: a nested node reported 16px
   * right and 66px below where it actually is.
   *
   * That is why callers wanting a relative position had to subtract the same
   * three constants straight back off, and why `positionAbsolute` — React
   * Flow's own answer, which carries no offset — disagreed with this one.
   *
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
      let currentId: string | undefined = nodeId
      while (currentId) {
        const currentParentId: string | undefined = blocks[currentId]?.data?.parentId
        if (!currentParentId) break
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
        width: parentNode
          ? getNodeDataDimension(parentNode, 'width', CONTAINER_DIMENSIONS.DEFAULT_WIDTH)
          : CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
        height: parentNode
          ? getNodeDataDimension(parentNode, 'height', CONTAINER_DIMENSIONS.DEFAULT_HEIGHT)
          : CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
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
          const width = getNodeDataDimension(n, 'width', CONTAINER_DIMENSIONS.DEFAULT_WIDTH)
          const height = getNodeDataDimension(n, 'height', CONTAINER_DIMENSIONS.DEFAULT_HEIGHT)
          const rect = {
            left: absolutePos.x,
            right: absolutePos.x + width,
            top: absolutePos.y,
            bottom: absolutePos.y + height,
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
            width: getNodeDataDimension(n, 'width', CONTAINER_DIMENSIONS.DEFAULT_WIDTH),
            height: getNodeDataDimension(n, 'height', CONTAINER_DIMENSIONS.DEFAULT_HEIGHT),
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
   * Child heights come from {@link getBlockDimensions}, which estimates from
   * block state when a card has not mounted yet and lands on the height it will
   * render — so the size computed before the cards report matches the one after,
   * and the container does not resize behind the user.
   *
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
          /* Sized from `currentBlocks`, the same snapshot the position came
             from. Reading dimensions off the hook's render snapshot instead
             mixed two ages of the same store: `resizeLoopNodes` walks
             deepest-first, so an inner container resized earlier in the pass
             was already updated here but still old there, and the parent sized
             against a stale inner box — leaving nested containers to converge
             over a second pass. */
          const { width, height } = dimensionsOfBlock(child)
          return { x: child.position.x, y: child.position.y, width, height }
        })
        .filter((position): position is NonNullable<typeof position> => position !== null)

      return calculateContainerDimensions(childPositions)
    },
    [dimensionsOfBlock]
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
        : typeof node.measured?.width === 'number'
          ? node.measured.width
          : typeof node.width === 'number'
            ? node.width
            : 250
      const height = isSubflow
        ? typeof node.data?.height === 'number'
          ? node.data.height
          : 300
        : typeof node.measured?.height === 'number'
          ? node.measured.height
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
