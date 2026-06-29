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
  WORKFLOW_CONTENT_PADDING: 16,
  WORKFLOW_ROW_HEIGHT: 29,
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
 * Handle position constants - must match CSS in workflow-block.tsx and subflow-node.tsx
 */
export const HANDLE_POSITIONS = {
  /** Default Y offset from block top for source/target handles */
  DEFAULT_Y_OFFSET: 20,
  /** Error handle offset from block bottom */
  ERROR_BOTTOM_OFFSET: 17,
  /** Condition handle starting Y offset */
  CONDITION_START_Y: 60,
  /** Height per condition row */
  CONDITION_ROW_HEIGHT: 29,
  /** Subflow start handle Y offset (header 50px + pill offset 16px + pill center 14px) */
  SUBFLOW_START_Y_OFFSET: 80,
} as const
