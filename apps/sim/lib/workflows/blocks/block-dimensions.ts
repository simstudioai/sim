/**
 * Shared Block Dimension Constants
 *
 * Single source of truth for block dimensions used by:
 * - UI components (workflow-block, note-block)
 * - Autolayout system
 * - Node utilities
 *
 * IMPORTANT: These values must match the actual CSS dimensions in the UI.
 * Changing these values will affect both rendering and layout calculations.
 */

/**
 * Block dimension constants for workflow blocks
 */
export const BLOCK_DIMENSIONS = {
  /** Fixed width for all workflow blocks (matches w-[250px] in workflow-block.tsx) */
  FIXED_WIDTH: 250,

  /** Header height for blocks */
  HEADER_HEIGHT: 40,

  /** Minimum height for blocks */
  MIN_HEIGHT: 100,

  /** Padding around workflow block content (p-[8px] top + bottom = 16px) */
  WORKFLOW_CONTENT_PADDING: 16,

  /** Height of each subblock row (14px text + 8px gap + padding) */
  WORKFLOW_ROW_HEIGHT: 29,

  /** Padding around note block content */
  NOTE_CONTENT_PADDING: 14,

  /** Minimum content height for note blocks */
  NOTE_MIN_CONTENT_HEIGHT: 20,

  /** Base content height for note blocks */
  NOTE_BASE_CONTENT_HEIGHT: 60,
} as const

/**
 * Container block dimension constants (loop, parallel, subflow)
 */
export const CONTAINER_DIMENSIONS = {
  /** Default width for container blocks */
  DEFAULT_WIDTH: 500,

  /** Default height for container blocks */
  DEFAULT_HEIGHT: 300,

  /** Minimum width for container blocks */
  MIN_WIDTH: 400,

  /** Minimum height for container blocks */
  MIN_HEIGHT: 200,
} as const
