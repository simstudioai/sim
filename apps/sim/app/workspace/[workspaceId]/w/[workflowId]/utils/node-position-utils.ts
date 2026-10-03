import { BLOCK_DIMENSIONS, CONTAINER_DIMENSIONS, getNoteBlockHeight } from '@sim/workflow-renderer'
import { showsCanvasErrorRow } from '@/lib/workflows/blocks/canvas-rows'
import { calculateWorkflowBlockDimensions } from '@/lib/workflows/blocks/deterministic-dimensions'
import { getBlock } from '@/blocks/registry'

/**
 * Estimates block dimensions for a block that has not been measured yet, from
 * its type alone — the caller has no subblock values to work from, so the row
 * count is a guess bounded to a plausible range.
 *
 * Routed through {@link calculateWorkflowBlockDimensions} rather than summing
 * rows locally: that function owns the section gaps, the error-row height, and
 * the painted floor, and a second copy of the arithmetic here drifted from it
 * the moment any of those changed.
 *
 * @param blockType - The type of block (e.g., 'condition', 'agent')
 * @returns Estimated width and height for the block
 */
export function estimateBlockDimensions(blockType: string): { width: number; height: number } {
  if (blockType === 'note') {
    return {
      width: BLOCK_DIMENSIONS.NOTE_WIDTH,
      height: getNoteBlockHeight(true),
    }
  }

  const blockConfig = getBlock(blockType)
  const subBlockCount = blockConfig?.subBlocks?.length ?? 3
  const estimatedRows = Math.max(3, Math.min(Math.ceil(subBlockCount / 2), 7))

  return calculateWorkflowBlockDimensions({
    blockType,
    visibleSubBlockCount: estimatedRows,
    hasErrorRow: blockConfig
      ? showsCanvasErrorRow(blockConfig, blockType, false)
      : blockType !== 'starter' && blockType !== 'response',
  })
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
 * Child coordinates are relative to the container's own origin — React Flow
 * places a child at the parent's origin plus its position, and
 * {@link clampPositionToContainer} keeps them clear of the chrome by flooring
 * them at `LEFT_PADDING` and `HEADER_HEIGHT + TOP_PADDING`. A child's far edge
 * is therefore already the distance the container has to cover, and only the
 * trailing padding is owed on top. Adding the header and leading padding here
 * as well counted them twice, leaving every container 66px taller and 16px
 * wider than its contents.
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
    maxRight + CONTAINER_DIMENSIONS.RIGHT_PADDING
  )
  const height = Math.max(
    CONTAINER_DIMENSIONS.DEFAULT_HEIGHT,
    maxBottom + CONTAINER_DIMENSIONS.BOTTOM_PADDING
  )

  return { width, height }
}
