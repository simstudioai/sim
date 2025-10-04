import { TriggerUtils } from '@/lib/workflows/triggers'
import type { BlockState } from '@/stores/workflows/workflow/types'
import type { BlockMetrics, BoundingBox, GraphNode } from './types'

export const DEFAULT_BLOCK_WIDTH = 350
export const DEFAULT_BLOCK_WIDTH_WIDE = 480
export const DEFAULT_BLOCK_HEIGHT = 100
export const DEFAULT_CONTAINER_WIDTH = 500
export const DEFAULT_CONTAINER_HEIGHT = 300
const DEFAULT_PADDING = 40

export const CONTAINER_PADDING = 150
export const CONTAINER_PADDING_X = 180
export const CONTAINER_PADDING_Y = 100
export const ROOT_PADDING_X = 150
export const ROOT_PADDING_Y = 150

function resolveNumeric(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

export function isContainerType(blockType: string): boolean {
  return blockType === 'loop' || blockType === 'parallel'
}

function getContainerMetrics(block: BlockState): BlockMetrics {
  const measuredWidth = block.layout?.measuredWidth
  const measuredHeight = block.layout?.measuredHeight

  const containerWidth = Math.max(
    measuredWidth ?? 0,
    resolveNumeric(block.data?.width, DEFAULT_CONTAINER_WIDTH)
  )
  const containerHeight = Math.max(
    measuredHeight ?? 0,
    resolveNumeric(block.data?.height, DEFAULT_CONTAINER_HEIGHT)
  )

  return {
    width: containerWidth,
    height: containerHeight,
    minWidth: DEFAULT_CONTAINER_WIDTH,
    minHeight: DEFAULT_CONTAINER_HEIGHT,
    paddingTop: DEFAULT_PADDING,
    paddingBottom: DEFAULT_PADDING,
    paddingLeft: DEFAULT_PADDING,
    paddingRight: DEFAULT_PADDING,
  }
}

function getRegularBlockMetrics(block: BlockState): BlockMetrics {
  const minWidth = block.isWide ? DEFAULT_BLOCK_WIDTH_WIDE : DEFAULT_BLOCK_WIDTH
  const minHeight = DEFAULT_BLOCK_HEIGHT
  const measuredH = block.layout?.measuredHeight ?? block.height
  const measuredW = block.layout?.measuredWidth

  const width = Math.max(measuredW ?? minWidth, minWidth)
  const height = Math.max(measuredH ?? minHeight, minHeight)

  return {
    width,
    height,
    minWidth,
    minHeight,
    paddingTop: DEFAULT_PADDING,
    paddingBottom: DEFAULT_PADDING,
    paddingLeft: DEFAULT_PADDING,
    paddingRight: DEFAULT_PADDING,
  }
}

export function getBlockMetrics(block: BlockState): BlockMetrics {
  if (isContainerType(block.type)) {
    return getContainerMetrics(block)
  }

  return getRegularBlockMetrics(block)
}

export function prepareBlockMetrics(nodes: Map<string, GraphNode>): void {
  for (const node of nodes.values()) {
    node.metrics = getBlockMetrics(node.block)
  }
}

export function createBoundingBox(
  position: { x: number; y: number },
  dimensions: Pick<BlockMetrics, 'width' | 'height'>
): BoundingBox {
  return {
    x: position.x,
    y: position.y,
    width: dimensions.width,
    height: dimensions.height,
  }
}

export function boxesOverlap(box1: BoundingBox, box2: BoundingBox, margin = 0): boolean {
  return !(
    box1.x + box1.width + margin <= box2.x ||
    box2.x + box2.width + margin <= box1.x ||
    box1.y + box1.height + margin <= box2.y ||
    box2.y + box2.height + margin <= box1.y
  )
}

export function getBlocksByParent(blocks: Record<string, BlockState>): {
  root: string[]
  children: Map<string, string[]>
} {
  const root: string[] = []
  const children = new Map<string, string[]>()

  for (const [id, block] of Object.entries(blocks)) {
    const parentId = block.data?.parentId

    if (!parentId) {
      root.push(id)
    } else {
      if (!children.has(parentId)) {
        children.set(parentId, [])
      }
      children.get(parentId)!.push(id)
    }
  }

  return { root, children }
}

export function isStarterBlock(block: BlockState): boolean {
  if (TriggerUtils.isTriggerBlock({ type: block.type, triggerMode: block.triggerMode })) {
    return true
  }

  return false
}
