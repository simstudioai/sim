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
  /** Footer divider above the error row: 1px border + 6px padding */
  WORKFLOW_FOOTER_DIVIDER_HEIGHT: 7,
  NOTE_CONTENT_PADDING: 14,
  NOTE_MIN_CONTENT_HEIGHT: 20,
  NOTE_BASE_CONTENT_HEIGHT: 60,
} as const

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
  /** Default Y offset from block top for source/target handles */
  DEFAULT_Y_OFFSET: 20,
  /** Error handle offset from block bottom */
  ERROR_BOTTOM_OFFSET: 17,
  /** Error knob center inset from the card's right edge. */
  ERROR_RIGHT_OFFSET: 30,
  /**
   * Y of the first condition-row handle: 40px header + 1px divider +
   * 8px content padding + half of the 20px row
   */
  CONDITION_START_Y: 59,
  /** Row pitch: 20px row height (h-5) + 8px flex gap (gap-2) */
  CONDITION_ROW_HEIGHT: 28,
  /** Subflow start handle Y offset (header 50px + pill offset 16px + pill center 14px) */
  SUBFLOW_START_Y_OFFSET: 80,
} as const
