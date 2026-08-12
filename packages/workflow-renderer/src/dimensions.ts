/**
 * Shared Block Dimension Constants
 *
 * Single source of truth for block dimensions used by:
 * - UI components (workflow-block, note-block, subflow-node)
 * - Autolayout system
 * - Node utilities
 */

export const BLOCK_DIMENSIONS = {
  FIXED_WIDTH: 250,
  NOTE_WIDTH: 320,
  NOTE_EXPANDED_WIDTH: 520,
  NOTE_EXPANDED_HEIGHT: 400,
  HEADER_HEIGHT: 40,
  MIN_HEIGHT: 100,
  /**
   * Shortest card the border renderer reliably paints. Below ~48px its
   * animation frame yields no path and the card renders bodiless. Header-only
   * cards must size their DOM host to this same value — a shorter host with
   * `preserveAspectRatio='none'` vertically squashes the action-menu tab.
   */
  MIN_PAINTED_HEIGHT: 48,
  WORKFLOW_CONTENT_PADDING: 16,
  /** One rendered summary row (text-sm line box). */
  WORKFLOW_ROW_HEIGHT: 20,
  /** `gap-2` between sections inside the card's content column. */
  WORKFLOW_CONTENT_GAP: 8,
  /** The error-output row: a short gray bar sized to its 20px switch. */
  WORKFLOW_ERROR_ROW_HEIGHT: 24,
  /** Chips row: the 20px ChipTag itself — the gap to the next section is
   * added by WORKFLOW_CONTENT_GAP, not baked in here. */
  WORKFLOW_CHIPS_ROW_HEIGHT: 20,
  /** Natural-language summary line height (text-sm with inline value chips). */
  WORKFLOW_SENTENCE_LINE_HEIGHT: 24,
  /** Total vertical spacing around an empty note's single text line. */
  NOTE_CONTENT_PADDING: 10,
  NOTE_MIN_CONTENT_HEIGHT: 20,
  /** Tallest a note grows inline before its content starts scrolling. */
  NOTE_CONTENT_VIEWPORT_HEIGHT: 200,
  /** Inset of the subflow Start card from the top of the container body. */
  SUBFLOW_START_TOP_OFFSET: 12,
  /** The subflow Start card itself. */
  SUBFLOW_START_HEIGHT: 34,
  SUBFLOW_START_WIDTH: 58,
} as const

/**
 * The bounds a note's total on-canvas height can occupy.
 *
 * These two numbers are the single source of truth for note sizing — the DOM
 * host, the border SVG viewBox (`preserveAspectRatio='none'`, so a mismatch
 * paints the outline stretched), and autolayout all resolve through them.
 */
export const NOTE_BLOCK_MIN_HEIGHT =
  BLOCK_DIMENSIONS.HEADER_HEIGHT +
  BLOCK_DIMENSIONS.NOTE_CONTENT_PADDING +
  BLOCK_DIMENSIONS.NOTE_MIN_CONTENT_HEIGHT
export const NOTE_BLOCK_MAX_HEIGHT =
  BLOCK_DIMENSIONS.HEADER_HEIGHT + BLOCK_DIMENSIONS.NOTE_CONTENT_VIEWPORT_HEIGHT

/** Clamps a note's total height to the bounds the card itself honours. */
export const clampNoteBlockTotalHeight = (totalHeight: number) =>
  Math.min(NOTE_BLOCK_MAX_HEIGHT, Math.max(NOTE_BLOCK_MIN_HEIGHT, totalHeight))

/** The height a note paints at when it has nothing measured yet. */
export const getNoteBlockHeight = (isEmpty: boolean) =>
  isEmpty ? NOTE_BLOCK_MIN_HEIGHT : NOTE_BLOCK_MAX_HEIGHT

/** Clamps measured note *content* to the same bounds, adding the header. */
export const clampNoteBlockHeight = (contentHeight: number) =>
  clampNoteBlockTotalHeight(BLOCK_DIMENSIONS.HEADER_HEIGHT + contentHeight)

/** Gives Notes a stable first frame before the rendered text can be measured. */
export const estimateNoteBlockHeight = (content: string) => {
  if (content.trim().length === 0) return getNoteBlockHeight(true)
  const lineCount = Math.max(1, content.split('\n').length)
  return clampNoteBlockHeight(
    BLOCK_DIMENSIONS.NOTE_CONTENT_PADDING + lineCount * BLOCK_DIMENSIONS.NOTE_MIN_CONTENT_HEIGHT
  )
}

export const CONTAINER_DIMENSIONS = {
  DEFAULT_WIDTH: 500,
  DEFAULT_HEIGHT: 300,
  MIN_WIDTH: 400,
  MIN_HEIGHT: 200,
  HEADER_HEIGHT: 50,
  LEFT_PADDING: 16,
  RIGHT_PADDING: 80,
  TOP_PADDING: 16,
  BOTTOM_PADDING: 16,
} as const

/**
 * Handle position constants - must match CSS in workflow-block-view.tsx,
 * sub-block-row-view.tsx, and subflow-node.tsx
 */
export const HANDLE_POSITIONS = {
  /** Error knob center inset from the card's right edge. */
  ERROR_RIGHT_OFFSET: 30,
  /**
   * Y of the first condition-row handle: 40px header + 8px content padding +
   * half of the 20px row. The 1px divider this used to include was removed
   * from the card, which left every branch handle sitting a pixel low.
   */
  CONDITION_START_Y: 58,
  /** Row pitch: 20px row height (h-5) + 8px flex gap (gap-2) */
  CONDITION_ROW_HEIGHT: 28,
  /**
   * Y of every port on a loop/parallel container — its own input and output as
   * well as the inset Start card's output, which all line up with the centre of
   * that card. Derived, not spelled out: auto-layout positions edges against
   * this number while the renderer paints handles at it, so a literal here
   * silently tilts every container edge the moment the Start card moves.
   */
  SUBFLOW_CONNECTION_Y:
    BLOCK_DIMENSIONS.HEADER_HEIGHT +
    BLOCK_DIMENSIONS.SUBFLOW_START_TOP_OFFSET +
    BLOCK_DIMENSIONS.SUBFLOW_START_HEIGHT / 2,
} as const
