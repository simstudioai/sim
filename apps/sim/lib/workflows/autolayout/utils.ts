import { TriggerUtils } from '@/lib/workflows/triggers'
import type { BlockState } from '@/stores/workflows/workflow/types'
import type { BlockDimensions, BoundingBox } from './types'

export const DEFAULT_BLOCK_WIDTH = 350
export const DEFAULT_BLOCK_WIDTH_WIDE = 480
export const DEFAULT_BLOCK_HEIGHT = 100
export const DEFAULT_CONTAINER_WIDTH = 500
export const DEFAULT_CONTAINER_HEIGHT = 300

export function isContainerType(blockType: string): boolean {
  return blockType === 'loop' || blockType === 'parallel'
}

export function getBlockDimensions(block: BlockState): BlockDimensions {
  if (isContainerType(block.type)) {
    return {
      width: block.data?.width ? Math.max(block.data.width, 400) : DEFAULT_CONTAINER_WIDTH,
      height: block.data?.height ? Math.max(block.data.height, 200) : DEFAULT_CONTAINER_HEIGHT,
    }
  }

  return {
    width: block.isWide ? DEFAULT_BLOCK_WIDTH_WIDE : DEFAULT_BLOCK_WIDTH,
    height: Math.max(block.height || DEFAULT_BLOCK_HEIGHT, DEFAULT_BLOCK_HEIGHT),
  }
}

export function createBoundingBox(
  position: { x: number; y: number },
  dimensions: BlockDimensions
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

  return block.triggerMode === true
}
