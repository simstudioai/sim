import { BLOCK_DIMENSIONS } from '@/lib/workflows/blocks/block-dimensions'
import type { BlockConfig } from '@/blocks/types'

interface WorkflowBlockDimensionsInput {
  blockType: string
  category: BlockConfig['category']
  displayTriggerMode: boolean
  visibleSubBlockCount: number
  conditionRowCount?: number
  routerRowCount?: number
}

export function calculateWorkflowBlockDimensions({
  blockType,
  category,
  displayTriggerMode,
  visibleSubBlockCount,
  conditionRowCount = 0,
  routerRowCount = 0,
}: WorkflowBlockDimensionsInput): { width: number; height: number } {
  const shouldShowDefaultHandles =
    category !== 'triggers' && blockType !== 'starter' && !displayTriggerMode
  const defaultHandlesRow = shouldShowDefaultHandles ? 1 : 0

  let rowsCount = 0
  if (blockType === 'condition') {
    rowsCount = conditionRowCount + defaultHandlesRow
  } else if (blockType === 'router_v2') {
    rowsCount = 1 + routerRowCount + defaultHandlesRow
  } else {
    rowsCount = visibleSubBlockCount + defaultHandlesRow
  }

  const hasContentBelowHeader = rowsCount > 0
  const contentHeight = hasContentBelowHeader
    ? BLOCK_DIMENSIONS.WORKFLOW_CONTENT_PADDING + rowsCount * BLOCK_DIMENSIONS.WORKFLOW_ROW_HEIGHT
    : 0
  const height = Math.max(
    BLOCK_DIMENSIONS.HEADER_HEIGHT + contentHeight,
    BLOCK_DIMENSIONS.MIN_HEIGHT
  )

  return {
    width: BLOCK_DIMENSIONS.FIXED_WIDTH,
    height,
  }
}
