import { createLogger } from '@/lib/logs/console/logger'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { assignLayers, groupByLayer } from './layering'
import { calculatePositions } from './positioning'
import type { Edge, LayoutOptions } from './types'
import {
  DEFAULT_CONTAINER_HEIGHT,
  DEFAULT_CONTAINER_WIDTH,
  getBlockMetrics,
  getBlocksByParent,
  prepareBlockMetrics,
} from './utils'

const logger = createLogger('AutoLayout:Targeted')

const ROOT_PADDING_X = 150
const ROOT_PADDING_Y = 150
const CONTAINER_PADDING_X = 180
const CONTAINER_PADDING_Y = 100

export interface TargetedLayoutOptions extends LayoutOptions {
  changedBlockIds: string[]
  verticalSpacing?: number
  horizontalSpacing?: number
}

export function applyTargetedLayout(
  blocks: Record<string, BlockState>,
  edges: Edge[],
  options: TargetedLayoutOptions
): Record<string, BlockState> {
  const { changedBlockIds, verticalSpacing = 200, horizontalSpacing = 550 } = options

  if (!changedBlockIds || changedBlockIds.length === 0) {
    return blocks
  }

  const changedSet = new Set(changedBlockIds)
  const blocksCopy: Record<string, BlockState> = JSON.parse(JSON.stringify(blocks))

  const groups = getBlocksByParent(blocksCopy)

  layoutGroup(null, groups.root, blocksCopy, edges, changedSet, verticalSpacing, horizontalSpacing)

  for (const [parentId, childIds] of groups.children.entries()) {
    layoutGroup(
      parentId,
      childIds,
      blocksCopy,
      edges,
      changedSet,
      verticalSpacing,
      horizontalSpacing
    )
  }

  return blocksCopy
}

function layoutGroup(
  parentId: string | null,
  childIds: string[],
  blocks: Record<string, BlockState>,
  edges: Edge[],
  changedSet: Set<string>,
  verticalSpacing: number,
  horizontalSpacing: number
): void {
  if (childIds.length === 0) return

  const parentBlock = parentId ? blocks[parentId] : undefined

  const needsLayout = childIds.filter((id) => {
    const block = blocks[id]
    if (!block) return false
    return changedSet.has(id) || !hasPosition(block)
  })

  if (needsLayout.length === 0) return

  const oldPositions = new Map<string, { x: number; y: number }>()

  for (const id of childIds) {
    const block = blocks[id]
    if (!block) continue
    oldPositions.set(id, { ...block.position })
  }

  const layoutPositions = computeLayoutPositions(
    childIds,
    blocks,
    edges,
    parentBlock,
    horizontalSpacing,
    verticalSpacing
  )

  if (layoutPositions.size === 0) return

  const bounds = getBounds(layoutPositions)

  let offsetX = 0
  let offsetY = 0

  const anchorId = childIds.find((id) => !needsLayout.includes(id) && layoutPositions.has(id))

  if (anchorId) {
    const oldPos = oldPositions.get(anchorId)
    const newPos = layoutPositions.get(anchorId)
    if (oldPos && newPos) {
      offsetX = oldPos.x - newPos.x
      offsetY = oldPos.y - newPos.y
    }
  } else {
    // No anchor - positions from calculatePositions are already correct relative to padding
    // Container positions are parent-relative, root positions are absolute
    // The normalization in computeLayoutPositions already handled the padding offset
    offsetX = 0
    offsetY = 0
  }

  for (const id of needsLayout) {
    const block = blocks[id]
    const newPos = layoutPositions.get(id)
    if (!block || !newPos) continue
    block.position = {
      x: newPos.x + offsetX,
      y: newPos.y + offsetY,
    }
  }

  if (parentBlock) {
    updateContainerDimensions(parentBlock, childIds, blocks)
  }
}

function computeLayoutPositions(
  childIds: string[],
  blocks: Record<string, BlockState>,
  edges: Edge[],
  parentBlock: BlockState | undefined,
  horizontalSpacing: number,
  verticalSpacing: number
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

  const nodes = assignLayers(subsetBlocks, subsetEdges)
  prepareBlockMetrics(nodes)

  const layoutOptions: LayoutOptions = parentBlock
    ? {
        horizontalSpacing: horizontalSpacing * 0.85,
        verticalSpacing,
        padding: { x: CONTAINER_PADDING_X, y: CONTAINER_PADDING_Y },
        alignment: 'center',
      }
    : {
        horizontalSpacing,
        verticalSpacing,
        padding: { x: ROOT_PADDING_X, y: ROOT_PADDING_Y },
        alignment: 'center',
      }

  calculatePositions(groupByLayer(nodes), layoutOptions)

  // Now normalize positions to start from 0,0 relative to the container/root
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY

  for (const node of nodes.values()) {
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
  }

  // Adjust all positions to be relative to the padding offset
  const xOffset = (parentBlock ? CONTAINER_PADDING_X : ROOT_PADDING_X) - minX
  const yOffset = (parentBlock ? CONTAINER_PADDING_Y : ROOT_PADDING_Y) - minY

  const positions = new Map<string, { x: number; y: number }>()
  for (const node of nodes.values()) {
    positions.set(node.id, {
      x: node.position.x + xOffset,
      y: node.position.y + yOffset,
    })
  }

  return positions
}

function getBounds(positions: Map<string, { x: number; y: number }>) {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY

  for (const pos of positions.values()) {
    minX = Math.min(minX, pos.x)
    minY = Math.min(minY, pos.y)
  }

  return { minX, minY }
}

function updateContainerDimensions(
  parentBlock: BlockState,
  childIds: string[],
  blocks: Record<string, BlockState>
): void {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const id of childIds) {
    const child = blocks[id]
    if (!child) continue
    const metrics = getBlockMetrics(child)

    minX = Math.min(minX, child.position.x)
    minY = Math.min(minY, child.position.y)
    maxX = Math.max(maxX, child.position.x + metrics.width)
    maxY = Math.max(maxY, child.position.y + metrics.height)
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return
  }

  parentBlock.data = {
    ...parentBlock.data,
    width: Math.max(maxX - minX + CONTAINER_PADDING_X * 2, DEFAULT_CONTAINER_WIDTH),
    height: Math.max(maxY - minY + CONTAINER_PADDING_Y * 2, DEFAULT_CONTAINER_HEIGHT),
  }
}

function hasPosition(block: BlockState): boolean {
  if (!block.position) return false
  return Math.abs(block.position.x) > 1 || Math.abs(block.position.y) > 1
}

/**
 * Estimate block heights for diff view by using current workflow measurements
 * This provides better height estimates than using default values
 */
export function transferBlockHeights(
  sourceBlocks: Record<string, BlockState>,
  targetBlocks: Record<string, BlockState>
): void {
  // Build a map of block type+name to heights from source
  const heightMap = new Map<string, { height: number; width: number; isWide: boolean }>()

  for (const [id, block] of Object.entries(sourceBlocks)) {
    const key = `${block.type}:${block.name}`
    heightMap.set(key, {
      height: block.height || 100,
      width: block.layout?.measuredWidth || (block.isWide ? 480 : 350),
      isWide: block.isWide || false,
    })
  }

  // Transfer heights to target blocks
  for (const block of Object.values(targetBlocks)) {
    const key = `${block.type}:${block.name}`
    const measurements = heightMap.get(key)

    if (measurements) {
      block.height = measurements.height
      block.isWide = measurements.isWide

      if (!block.layout) {
        block.layout = {}
      }
      block.layout.measuredHeight = measurements.height
      block.layout.measuredWidth = measurements.width
    }
  }

  logger.debug('Transferred block heights from source workflow', {
    sourceCount: Object.keys(sourceBlocks).length,
    targetCount: Object.keys(targetBlocks).length,
    heightsMapped: heightMap.size,
  })
}
