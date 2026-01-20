import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS } from '@/lib/workflows/blocks/block-dimensions'
import { getBlock } from '@/blocks/registry'

/**
 * Estimates block dimensions based on block type.
 * Uses subblock count to estimate height for blocks that haven't been measured yet.
 *
 * @param blockType - The type of block (e.g., 'condition', 'agent')
 * @returns Estimated width and height for the block
 */
export function estimateBlockDimensions(blockType: string): { width: number; height: number } {
  const blockConfig = getBlock(blockType)
  const subBlockCount = blockConfig?.subBlocks?.length ?? 3
  const estimatedRows = Math.max(3, Math.min(Math.ceil(subBlockCount / 2), 7))
  const hasErrorRow = blockType !== 'starter' && blockType !== 'response' ? 1 : 0

  const height =
    BLOCK_DIMENSIONS.HEADER_HEIGHT +
    BLOCK_DIMENSIONS.WORKFLOW_CONTENT_PADDING +
    (estimatedRows + hasErrorRow) * BLOCK_DIMENSIONS.WORKFLOW_ROW_HEIGHT

  return {
    width: BLOCK_DIMENSIONS.FIXED_WIDTH,
    height: Math.max(height, BLOCK_DIMENSIONS.MIN_HEIGHT),
  }
}

/**
 * Clamps a position to keep a block fully inside a container's content area.
 * Content area starts after the header and padding, and ends before the right/bottom padding.
 *
 * @param position - Raw position relative to container origin
 * @param containerDimensions - Container width and height
 * @param blockDimensions - Block width and height
 * @returns Clamped position that keeps block inside content area
 */
export function clampPositionToContainer(
  position: { x: number; y: number },
  containerDimensions: { width: number; height: number },
  blockDimensions: { width: number; height: number }
): { x: number; y: number } {
  const { width: containerWidth, height: containerHeight } = containerDimensions
  const { width: blockWidth, height: blockHeight } = blockDimensions

  const minX = CONTAINER_DIMENSIONS.LEFT_PADDING
  const minY = CONTAINER_DIMENSIONS.HEADER_HEIGHT + CONTAINER_DIMENSIONS.TOP_PADDING
  const maxX = containerWidth - CONTAINER_DIMENSIONS.RIGHT_PADDING - blockWidth
  const maxY = containerHeight - CONTAINER_DIMENSIONS.BOTTOM_PADDING - blockHeight

  return {
    x: Math.max(minX, Math.min(position.x, Math.max(minX, maxX))),
    y: Math.max(minY, Math.min(position.y, Math.max(minY, maxY))),
  }
}

/**
 * Calculates container dimensions based on child block positions.
 * Single source of truth for container sizing - ensures consistency between
 * live drag updates and final dimension calculations.
 *
 * @param childPositions - Array of child positions with their dimensions
 * @returns Calculated width and height for the container
 */
export function calculateContainerDimensions(
  childPositions: Array<{ x: number; y: number; width: number; height: number }>
): { width: number; height: number } {
  if (childPositions.length === 0) {
    return {
      width: CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
      height: CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
    }
  }

  let maxRight = 0
  let maxBottom = 0

  for (const child of childPositions) {
    maxRight = Math.max(maxRight, child.x + child.width)
    maxBottom = Math.max(maxBottom, child.y + child.height)
  }

  const width = Math.max(
    CONTAINER_DIMENSIONS.DEFAULT_WIDTH,
    CONTAINER_DIMENSIONS.LEFT_PADDING + maxRight + CONTAINER_DIMENSIONS.RIGHT_PADDING
  )
  const height = Math.max(
    CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
    CONTAINER_DIMENSIONS.HEADER_HEIGHT +
      CONTAINER_DIMENSIONS.TOP_PADDING +
      maxBottom +
      CONTAINER_DIMENSIONS.BOTTOM_PADDING
  )

  return { width, height }
}
