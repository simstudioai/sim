import { BLOCK_DIMENSIONS } from '@sim/workflow-renderer'
import type { CanvasPort } from '@/lib/workflows/blocks/canvas-ports'
import { calculateWorkflowBlockDimensions } from '@/lib/workflows/blocks/deterministic-dimensions'
import { getDynamicHandleRows } from '@/lib/workflows/dynamic-handle-topology'
import { getDisplayValue } from '@/lib/workflows/subblocks/display'
import type { BlockState } from '@/stores/workflows/workflow/types'

/** The CSS border and measured preview box use the same width. */
export const PREVIEW_CARD_BORDER_WIDTH = 1.5

export interface PreviewPortRow {
  handleId?: string
  type?: CanvasPort['type']
  title: string
  value: string
  field?: string
  removed?: boolean
}

/** Target roles are resolved before removed rows are appended. */
export function getPreviewPortRows(
  block: Pick<BlockState, 'id' | 'type'> & {
    subBlocks: Record<string, { value: unknown }>
  },
  removedPorts: readonly CanvasPort[] = []
): PreviewPortRow[] {
  const rows: PreviewPortRow[] = getDynamicHandleRows(block).map((row) => ({
    ...row,
    type: 'source',
    field: block.type === 'condition' ? 'conditions' : 'routes',
  }))
  if (block.type === 'router_v2') {
    rows.unshift({
      title: 'Context',
      field: 'context',
      value: getDisplayValue(block.subBlocks.context?.value),
    })
  }
  return [...rows, ...removedPorts.map((row) => ({ ...row, removed: true }))]
}

/** Height of the fixed-height row column, including its own padding and gaps. */
export function getPreviewPortContentHeight(rowCount: number): number {
  if (rowCount === 0) return 0
  return (
    calculateWorkflowBlockDimensions({
      blockType: 'condition',
      visibleSubBlockCount: 0,
      conditionRowCount: rowCount,
    }).height - BLOCK_DIMENSIONS.HEADER_HEIGHT
  )
}
