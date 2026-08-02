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
  /** Total vertical padding around the note's content viewport (`p-2`). */
  NOTE_CONTENT_PADDING: 16,
  /**
   * The content wrapper's own `py-2`, inside the viewport's `p-2`. Only the
   * empty note is sized by its content, so this is the one case where it adds
   * to the card; a filled note is pinned by NOTE_CONTENT_VIEWPORT_HEIGHT.
   */
  NOTE_INNER_CONTENT_PADDING: 16,
  NOTE_MIN_CONTENT_HEIGHT: 20,
  /** Bounded canvas preview, including its `p-2`; full content stays in the editor. */
  NOTE_CONTENT_VIEWPORT_HEIGHT: 176,
  /** Inset of the subflow Start card from the top of the container body. */
  SUBFLOW_START_TOP_OFFSET: 12,
  /** The subflow Start card itself. */
  SUBFLOW_START_HEIGHT: 34,
  SUBFLOW_START_WIDTH: 58,
} as const

/**
 * Keeps note DOM, React Flow bounds, and auto-layout on the same height.
 *
 * Every term here has to appear in the rendered DOM or the border SVG — which
 * is sized from the host but builds its viewBox from this number under
 * `preserveAspectRatio='none'` — paints the card's outline stretched.
 */
export const getNoteBlockHeight = (isEmpty: boolean) =>
  BLOCK_DIMENSIONS.HEADER_HEIGHT +
  (isEmpty
    ? BLOCK_DIMENSIONS.NOTE_CONTENT_PADDING +
      BLOCK_DIMENSIONS.NOTE_INNER_CONTENT_PADDING +
      BLOCK_DIMENSIONS.NOTE_MIN_CONTENT_HEIGHT
    : BLOCK_DIMENSIONS.NOTE_CONTENT_VIEWPORT_HEIGHT)

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
   * Y of the first condition-row handle: 40px header + 1px divider +
   * 8px content padding + half of the 20px row
   */
  CONDITION_START_Y: 59,
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
