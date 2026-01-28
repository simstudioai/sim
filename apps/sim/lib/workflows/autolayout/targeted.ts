import {
  CONTAINER_PADDING,
  DEFAULT_HORIZONTAL_SPACING,
  DEFAULT_VERTICAL_SPACING,
} from '@/lib/workflows/autolayout/constants'
import { assignLayers, layoutBlocksCore } from '@/lib/workflows/autolayout/core'
import type { Edge, LayoutOptions } from '@/lib/workflows/autolayout/types'
import {
  calculateSubflowDepths,
  filterLayoutEligibleBlockIds,
  getBlockMetrics,
  getBlocksByParent,
  isContainerType,
  prepareContainerDimensions,
  shouldSkipAutoLayout,
  snapPositionToGrid,
} from '@/lib/workflows/autolayout/utils'
import { CONTAINER_DIMENSIONS } from '@/lib/workflows/blocks/block-dimensions'
import type { BlockState } from '@/stores/workflows/workflow/types'

export interface TargetedLayoutOptions extends LayoutOptions {
  changedBlockIds: string[]
  verticalSpacing?: number
  horizontalSpacing?: number
}

/**
 * Applies targeted layout to only reposition changed blocks.
 * Unchanged blocks act as anchors to preserve existing layout.
 */
export function applyTargetedLayout(
  blocks: Record<string, BlockState>,
  edges: Edge[],
  options: TargetedLayoutOptions
): Record<string, BlockState> {
  const {
    changedBlockIds,
    verticalSpacing = DEFAULT_VERTICAL_SPACING,
    horizontalSpacing = DEFAULT_HORIZONTAL_SPACING,
    gridSize,
  } = options

  if (!changedBlockIds || changedBlockIds.length === 0) {
    return blocks
  }

  const changedSet = new Set(changedBlockIds)
  const blocksCopy: Record<string, BlockState> = JSON.parse(JSON.stringify(blocks))

  prepareContainerDimensions(
    blocksCopy,
    edges,
    layoutBlocksCore,
    horizontalSpacing,
    verticalSpacing,
    gridSize
  )

  const groups = getBlocksByParent(blocksCopy)

  const subflowDepths = calculateSubflowDepths(blocksCopy, edges, assignLayers)

  layoutGroup(
    null,
    groups.root,
    blocksCopy,
    edges,
    changedSet,
    verticalSpacing,
    horizontalSpacing,
    subflowDepths,
    gridSize
  )

  for (const [parentId, childIds] of groups.children.entries()) {
    layoutGroup(
      parentId,
      childIds,
      blocksCopy,
      edges,
      changedSet,
      verticalSpacing,
      horizontalSpacing,
      subflowDepths,
      gridSize
    )
  }

  return blocksCopy
}

/**
 * Layouts a group of blocks (either root level or within a container)
 */
function layoutGroup(
  parentId: string | null,
  childIds: string[],
  blocks: Record<string, BlockState>,
  edges: Edge[],
  changedSet: Set<string>,
  verticalSpacing: number,
  horizontalSpacing: number,
  subflowDepths: Map<string, number>,
  gridSize?: number
): void {
  if (childIds.length === 0) return

  const parentBlock = parentId ? blocks[parentId] : undefined

  const layoutEligibleChildIds = filterLayoutEligibleBlockIds(childIds, blocks)

  if (layoutEligibleChildIds.length === 0) {
    if (parentBlock) {
      updateContainerDimensions(parentBlock, childIds, blocks)
    }
    return
  }

  const requestedLayout = layoutEligibleChildIds.filter((id) => {
    const block = blocks[id]
    if (!block) return false
    if (isContainerType(block.type)) {
      return changedSet.has(id) && isDefaultPosition(block)
    }
    return changedSet.has(id)
  })
  const missingPositions = layoutEligibleChildIds.filter((id) => {
    const block = blocks[id]
    if (!block) return false
    return !hasPosition(block) || isDefaultPosition(block)
  })
  const needsLayoutSet = new Set([...requestedLayout, ...missingPositions])
  const needsLayout = Array.from(needsLayoutSet)

  if (parentBlock) {
    updateContainerDimensions(parentBlock, childIds, blocks)
  }

  if (needsLayout.length === 0) {
    return
  }

  const oldPositions = new Map<string, { x: number; y: number }>()
  for (const id of layoutEligibleChildIds) {
    const block = blocks[id]
    if (!block) continue
    oldPositions.set(id, { ...block.position })
  }

  const layoutPositions = computeLayoutPositions(
    layoutEligibleChildIds,
    blocks,
    edges,
    parentBlock,
    horizontalSpacing,
    verticalSpacing,
    parentId === null ? subflowDepths : undefined,
    gridSize
  )

  if (layoutPositions.size === 0) {
    if (parentBlock) {
      updateContainerDimensions(parentBlock, childIds, blocks)
    }
    return
  }

  let offsetX = 0
  let offsetY = 0

  const anchorId = layoutEligibleChildIds.find(
    (id) => !needsLayout.includes(id) && layoutPositions.has(id)
  )

  if (anchorId) {
    const oldPos = oldPositions.get(anchorId)
    const newPos = layoutPositions.get(anchorId)
    if (oldPos && newPos) {
      offsetX = oldPos.x - newPos.x
      offsetY = oldPos.y - newPos.y
    }
  }

  for (const id of needsLayout) {
    const block = blocks[id]
    const newPos = layoutPositions.get(id)
    if (!block || !newPos) continue
    block.position = snapPositionToGrid({ x: newPos.x + offsetX, y: newPos.y + offsetY }, gridSize)
  }
}

/**
 * Computes layout positions for a subset of blocks using the core layout function
 */
function computeLayoutPositions(
  childIds: string[],
  blocks: Record<string, BlockState>,
  edges: Edge[],
  parentBlock: BlockState | undefined,
  horizontalSpacing: number,
  verticalSpacing: number,
  subflowDepths?: Map<string, number>,
  gridSize?: number
): Map<string, { x: number; y: number }> {
  const subsetBlocks: Record<string, BlockState> = {}
  for (const id of childIds) {
    subsetBlocks[id] = blocks[id]
  }

  const subsetEdges = edges.filter(
    (edge) => childIds.includes(edge.source) && childIds.includes(edge.target)
  )

  if (Object.keys(subsetBlocks).length === 0) {
    return new Map()
  }

  const isContainer = !!parentBlock
  const { nodes, dimensions } = layoutBlocksCore(subsetBlocks, subsetEdges, {
    isContainer,
    layoutOptions: {
      horizontalSpacing: isContainer ? horizontalSpacing * 0.85 : horizontalSpacing,
      verticalSpacing,
      gridSize,
    },
    subflowDepths,
  })

  if (parentBlock) {
    parentBlock.data = {
      ...parentBlock.data,
      width: Math.max(dimensions.width, CONTAINER_DIMENSIONS.DEFAULT_WIDTH),
      height: Math.max(dimensions.height, CONTAINER_DIMENSIONS.DEFAULT_HEIGHT),
    }
  }

  const positions = new Map<string, { x: number; y: number }>()
  for (const node of nodes.values()) {
    positions.set(node.id, { x: node.position.x, y: node.position.y })
  }

  return positions
}

/**
 * Updates container dimensions based on children
 */
function updateContainerDimensions(
  parentBlock: BlockState,
  childIds: string[],
  blocks: Record<string, BlockState>
): void {
  if (childIds.length === 0) {
    parentBlock.data = {
      ...parentBlock.data,
      width: CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
      height: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
    }
    parentBlock.layout = {
      ...parentBlock.layout,
      measuredWidth: CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
      measuredHeight: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
    }
    return
  }

  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const id of childIds) {
    const child = blocks[id]
    if (!child) continue
    if (shouldSkipAutoLayout(child)) {
      continue
    }
    const metrics = getBlockMetrics(child)

    minX = Math.min(minX, child.position.x)
    minY = Math.min(minY, child.position.y)
    maxX = Math.max(maxX, child.position.x + metrics.width)
    maxY = Math.max(maxY, child.position.y + metrics.height)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return
  }

  const calculatedWidth = maxX - minX + CONTAINER_PADDING * 2
  const calculatedHeight = maxY - minY + CONTAINER_PADDING * 2

  parentBlock.data = {
    ...parentBlock.data,
    width: Math.max(calculatedWidth, CONTAINER_DIMENSIONS.DEFAULT_WIDTH),
    height: Math.max(calculatedHeight, CONTAINER_DIMENSIONS.DEFAULT_HEIGHT),
  }

  parentBlock.layout = {
    ...parentBlock.layout,
    measuredWidth: parentBlock.data.width,
    measuredHeight: parentBlock.data.height,
  }
}

/**
 * Checks if a block has a valid position
 */
function hasPosition(block: BlockState): boolean {
  if (!block.position) return false
  const { x, y } = block.position
  return Number.isFinite(x) && Number.isFinite(y)
}

/**
 * Checks if a block is at the default/uninitialized position (0, 0).
 * New blocks typically start at this position before being laid out.
 */
function isDefaultPosition(block: BlockState): boolean {
  if (!block.position) return true
  const { x, y } = block.position
  return x === 0 && y === 0
}
