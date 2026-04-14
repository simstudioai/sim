import {
  CONTAINER_PADDING,
  DEFAULT_HORIZONTAL_SPACING,
  DEFAULT_VERTICAL_SPACING,
  MAX_OVERLAP_ITERATIONS,
} from '@/lib/workflows/autolayout/constants'
import { assignLayers, layoutBlocksCore } from '@/lib/workflows/autolayout/core'
import type { Edge, LayoutOptions } from '@/lib/workflows/autolayout/types'
import {
  calculateSubflowDepths,
  filterLayoutEligibleBlockIds,
  getBlockMetrics,
  getBlocksByParent,
  prepareContainerDimensions,
  shouldSkipAutoLayout,
  snapPositionToGrid,
} from '@/lib/workflows/autolayout/utils'
import { CONTAINER_DIMENSIONS } from '@/lib/workflows/blocks/block-dimensions'
import type { BlockState } from '@/stores/workflows/workflow/types'

type TargetedBlockInfo = {
  id: string
  block: BlockState
  metrics: ReturnType<typeof getBlockMetrics>
}

export interface TargetedLayoutOptions extends LayoutOptions {
  changedBlockIds: string[]
  /** Existing blocks whose size changed but whose position should remain anchored. */
  resizedBlockIds?: string[]
  shiftSourceBlockIds?: string[]
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
    resizedBlockIds = [],
    shiftSourceBlockIds = [],
    verticalSpacing = DEFAULT_VERTICAL_SPACING,
    horizontalSpacing = DEFAULT_HORIZONTAL_SPACING,
    gridSize,
  } = options

  if (
    (!changedBlockIds || changedBlockIds.length === 0) &&
    resizedBlockIds.length === 0 &&
    shiftSourceBlockIds.length === 0
  ) {
    return blocks
  }

  const changedSet = new Set(changedBlockIds)
  const resizedSet = new Set(resizedBlockIds)
  const shiftSourceSet = new Set(shiftSourceBlockIds)
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
    resizedSet,
    shiftSourceSet,
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
      resizedSet,
      shiftSourceSet,
      verticalSpacing,
      horizontalSpacing,
      subflowDepths,
      gridSize
    )
  }

  return blocksCopy
}

/**
 * Selects the best anchor block for offset computation.
 * Prefers an upstream (predecessor) anchor over a downstream one because
 * upstream blocks keep their layer assignment when new blocks are inserted
 * after them, giving a stable offset. Downstream blocks shift to later
 * layers in the ideal layout, producing a large incorrect offset.
 */
function selectBestAnchor(
  eligibleIds: string[],
  needsLayoutSet: Set<string>,
  edges: Edge[],
  layoutPositions: Map<string, { x: number; y: number }>
): string | undefined {
  const candidates = eligibleIds.filter((id) => !needsLayoutSet.has(id) && layoutPositions.has(id))
  if (candidates.length === 0) return undefined
  if (candidates.length === 1) return candidates[0]

  const candidateSet = new Set(candidates)

  for (const edge of edges) {
    if (needsLayoutSet.has(edge.target) && candidateSet.has(edge.source)) {
      return edge.source
    }
  }

  for (const edge of edges) {
    if (needsLayoutSet.has(edge.source) && candidateSet.has(edge.target)) {
      return edge.target
    }
  }

  return candidates[0]
}

/**
 * Layouts a group of blocks (either root level or within a container).
 * Only repositions blocks in `changedSet` or those with invalid positions.
 * Resized existing blocks remain anchored and instead drive shifts in nearby
 * frozen blocks when their new dimensions create overlap.
 */
function layoutGroup(
  parentId: string | null,
  childIds: string[],
  blocks: Record<string, BlockState>,
  edges: Edge[],
  changedSet: Set<string>,
  resizedSet: Set<string>,
  shiftSourceSet: Set<string>,
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
    return changedSet.has(id)
  })
  const invalidPositions = layoutEligibleChildIds.filter((id) => {
    const block = blocks[id]
    if (!block) return false
    return !hasPosition(block)
  })
  const needsLayoutSet = new Set([...requestedLayout, ...invalidPositions])
  const needsLayout = Array.from(needsLayoutSet)
  const resizedAnchorIds = layoutEligibleChildIds.filter((id) => resizedSet.has(id))
  const groupShiftSourceIds = layoutEligibleChildIds.filter((id) => shiftSourceSet.has(id))
  const activeShiftSourceSet = new Set([
    ...needsLayoutSet,
    ...resizedAnchorIds,
    ...groupShiftSourceIds,
  ])

  if (needsLayout.length === 0 && activeShiftSourceSet.size === 0) {
    if (parentBlock) {
      updateContainerDimensions(parentBlock, childIds, blocks)
    }
    return
  }

  if (needsLayout.length > 0) {
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

    const anchorId = selectBestAnchor(
      layoutEligibleChildIds,
      needsLayoutSet,
      edges,
      layoutPositions
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
      block.position = snapPositionToGrid(
        { x: newPos.x + offsetX, y: newPos.y + offsetY },
        gridSize
      )
    }
  }

  const shiftedFrozenIds = shiftDownstreamFrozenBlocks(
    activeShiftSourceSet,
    needsLayoutSet,
    layoutEligibleChildIds,
    blocks,
    edges,
    horizontalSpacing,
    gridSize
  )

  const affectedBlockIds = new Set([...needsLayoutSet, ...resizedAnchorIds, ...shiftedFrozenIds])
  if (affectedBlockIds.size > 0) {
    resolveVerticalOverlapsWithFrozen(
      affectedBlockIds,
      layoutEligibleChildIds,
      blocks,
      verticalSpacing,
      gridSize
    )
  }

  if (parentBlock) {
    updateContainerDimensions(parentBlock, childIds, blocks)
  }
}

/**
 * Shifts frozen (unchanged) blocks rightward when a newly placed block
 * overlaps with them in the X-axis. Traverses the DAG forward from changed
 * blocks via BFS, cascading shifts through downstream frozen blocks so that
 * insertions between existing layers push everything after them to the right.
 *
 * Only considers edges within the current layout group (scoped to subflow).
 */
function shiftDownstreamFrozenBlocks(
  shiftSourceSet: Set<string>,
  needsLayoutSet: Set<string>,
  eligibleIds: string[],
  blocks: Record<string, BlockState>,
  edges: Edge[],
  horizontalSpacing: number,
  gridSize?: number
): Set<string> {
  const eligibleSet = new Set(eligibleIds)

  const downstreamMap = new Map<string, string[]>()
  for (const edge of edges) {
    if (!eligibleSet.has(edge.source) || !eligibleSet.has(edge.target)) continue
    if (!downstreamMap.has(edge.source)) downstreamMap.set(edge.source, [])
    downstreamMap.get(edge.source)!.push(edge.target)
  }

  const shifted = new Set<string>()
  const queue: string[] = Array.from(shiftSourceSet)

  while (queue.length > 0) {
    const sourceId = queue.shift()!
    const sourceBlock = blocks[sourceId]
    if (!sourceBlock) continue

    const sourceMetrics = getBlockMetrics(sourceBlock)
    const sourceRight = sourceBlock.position.x + sourceMetrics.width

    const successors = downstreamMap.get(sourceId) || []
    for (const targetId of successors) {
      if (needsLayoutSet.has(targetId)) continue
      if (shifted.has(targetId)) continue

      const targetBlock = blocks[targetId]
      if (!targetBlock) continue

      if (targetBlock.position.x < sourceRight + horizontalSpacing) {
        const shiftX = sourceRight + horizontalSpacing - targetBlock.position.x
        targetBlock.position = snapPositionToGrid(
          { x: targetBlock.position.x + shiftX, y: targetBlock.position.y },
          gridSize
        )
        shifted.add(targetId)
        queue.push(targetId)
      }
    }
  }

  return shifted
}

/**
 * Resolves Y-axis overlaps between changed/shifted blocks and frozen blocks
 * that share the same column (overlapping X ranges). When a new block is
 * inserted into the same layer as existing blocks (e.g. adding a parallel
 * branch), this pushes frozen blocks downward to make room, cascading
 * through any further blocks below.
 */
function resolveVerticalOverlapsWithFrozen(
  affectedBlockIds: Set<string>,
  eligibleIds: string[],
  blocks: Record<string, BlockState>,
  verticalSpacing: number,
  gridSize?: number
): void {
  const blockInfos = eligibleIds
    .map((id) => {
      const block = blocks[id]
      if (!block) return null
      return { id, block, metrics: getBlockMetrics(block) }
    })
    .filter((info): info is TargetedBlockInfo => info !== null)

  if (blockInfos.length < 2 || affectedBlockIds.size === 0) return

  const movedSet = new Set(affectedBlockIds)
  let hasOverlap = true
  let iteration = 0

  while (hasOverlap && iteration < MAX_OVERLAP_ITERATIONS) {
    hasOverlap = false
    iteration++

    blockInfos.sort((a, b) => a.block.position.y - b.block.position.y)

    for (let i = 0; i < blockInfos.length - 1; i++) {
      const upper = blockInfos[i]

      for (let lowerIndex = i + 1; lowerIndex < blockInfos.length; lowerIndex++) {
        const lower = blockInfos[lowerIndex]

        if (!movedSet.has(upper.id) && !movedSet.has(lower.id)) continue
        if (!blocksOverlapOnX(upper, lower)) continue

        const requiredY = upper.block.position.y + upper.metrics.height + verticalSpacing
        if (lower.block.position.y >= requiredY) continue

        lower.block.position = snapPositionToGrid(
          { x: lower.block.position.x, y: requiredY },
          gridSize
        )
        movedSet.add(lower.id)
        reorderBlockInfoByY(blockInfos, lowerIndex)
        hasOverlap = true
      }
    }
  }
}

function blocksOverlapOnX(left: TargetedBlockInfo, right: TargetedBlockInfo): boolean {
  const leftRight = left.block.position.x + left.metrics.width
  const rightRight = right.block.position.x + right.metrics.width
  return left.block.position.x < rightRight && right.block.position.x < leftRight
}

function reorderBlockInfoByY(blockInfos: TargetedBlockInfo[], fromIndex: number): void {
  const [movedInfo] = blockInfos.splice(fromIndex, 1)
  let insertIndex = fromIndex

  while (
    insertIndex < blockInfos.length &&
    blockInfos[insertIndex].block.position.y < movedInfo.block.position.y
  ) {
    insertIndex++
  }

  blockInfos.splice(insertIndex, 0, movedInfo)
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
 * Checks if a block has a valid, finite position.
 * Returns false for missing, undefined, NaN, or Infinity coordinates.
 */
function hasPosition(block: BlockState): boolean {
  if (!block.position) return false
  const { x, y } = block.position
  return Number.isFinite(x) && Number.isFinite(y)
}
