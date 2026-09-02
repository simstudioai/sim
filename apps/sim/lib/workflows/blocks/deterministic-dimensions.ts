import { BLOCK_DIMENSIONS } from '@sim/workflow-renderer/dimensions'

interface WorkflowBlockDimensionsInput {
  blockType: string
  visibleSubBlockCount: number
  conditionRowCount?: number
  routerRowCount?: number
  /** Number of value pills in the chips row (standard blocks only). */
  chipCount?: number
  /**
   * Estimated wrapped line count of the natural-language summary. When > 0
   * the summary replaces the chips row and all field rows.
   */
  sentenceLineCount?: number
  /**
   * Whether the card carries the error-output row. It is permanent for blocks
   * that can emit an error — it is the affordance for switching the output on —
   * so it holds a row whether or not the toggle is set.
   */
  hasErrorRow?: boolean
}

export function calculateWorkflowBlockDimensions({
  blockType,
  visibleSubBlockCount,
  conditionRowCount = 0,
  routerRowCount = 0,
  chipCount = 0,
  sentenceLineCount = 0,
  hasErrorRow = false,
}: WorkflowBlockDimensionsInput): { width: number; height: number } {
  const isBranchBlock = blockType === 'condition' || blockType === 'router_v2'

  let rowsCount = 0
  if (blockType === 'condition') {
    rowsCount = conditionRowCount
  } else if (blockType === 'router_v2') {
    rowsCount = 1 + routerRowCount
  } else {
    rowsCount = visibleSubBlockCount
  }

  const hasSentence = !isBranchBlock && sentenceLineCount > 0
  const chipsRowHeight =
    !isBranchBlock && !hasSentence && chipCount > 0 ? BLOCK_DIMENSIONS.WORKFLOW_CHIPS_ROW_HEIGHT : 0

  /*
   * The content column is `flex flex-col gap-2 p-2`, so its height is the sum
   * of the sections it renders plus one gap between each adjacent pair. Adding
   * the sections without the gaps (or applying a per-row pitch that bakes one
   * in) over-estimates, and the card's silhouette is painted from this number —
   * an over-estimate draws a card taller than its own content.
   */
  const sections: number[] = []
  if (chipsRowHeight > 0) sections.push(chipsRowHeight)
  if (hasSentence) {
    sections.push(sentenceLineCount * BLOCK_DIMENSIONS.WORKFLOW_SENTENCE_LINE_HEIGHT)
  } else {
    for (let index = 0; index < rowsCount; index++) {
      sections.push(BLOCK_DIMENSIONS.WORKFLOW_ROW_HEIGHT)
    }
  }
  if (hasErrorRow) sections.push(BLOCK_DIMENSIONS.WORKFLOW_ERROR_ROW_HEIGHT)
  const hasContentBelowHeader = sections.length > 0
  const contentHeight = hasContentBelowHeader
    ? BLOCK_DIMENSIONS.WORKFLOW_CONTENT_PADDING +
      sections.reduce((total, section) => total + section, 0) +
      (sections.length - 1) * BLOCK_DIMENSIONS.WORKFLOW_CONTENT_GAP
    : 0
  /*
   * The old `MIN_HEIGHT` (100) floor is gone: it stretched a header-only
   * trigger card to more than twice its content and painted an empty band
   * under the title. Consumers that need a minimum for canvas math (selection
   * bounds, paste placement) already clamp with MIN_HEIGHT themselves.
   *
   * `MIN_PAINTED_HEIGHT` (48) is the shortest silhouette the border renderer
   * will paint. Header-only cards (40px header) must still use this floor —
   * and size their DOM host to match — or `preserveAspectRatio='none'`
   * squashes the action-menu tab and leaves uneven gray under the icons.
   */
  const height = Math.max(
    BLOCK_DIMENSIONS.HEADER_HEIGHT + contentHeight,
    BLOCK_DIMENSIONS.MIN_PAINTED_HEIGHT
  )

  return {
    width: BLOCK_DIMENSIONS.FIXED_WIDTH,
    height,
  }
}
