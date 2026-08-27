import type { BlockState } from '@/stores/workflows/workflow/types'

export const Z_INDEX = {
  ROOT_BLOCK: 10,
  CHILD_BLOCK: 1000,
} as const

export function computeContainerZIndex(
  block: Pick<BlockState, 'data'>,
  allBlocks: Record<string, Pick<BlockState, 'data'>>
): number {
  let depth = 0
  let parentId = block.data?.parentId

  while (parentId && depth < 100) {
    depth++
    parentId = allBlocks[parentId]?.data?.parentId
  }

  return depth
}
