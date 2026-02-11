/**
 * Autolayout Constants
 *
 * Layout algorithm specific constants for spacing, padding, and overlap detection.
 * Block dimensions are in @/lib/workflows/blocks/block-dimensions
 */

/**
 * Horizontal spacing between layers (columns)
 */
export const DEFAULT_HORIZONTAL_SPACING = 180

/**
 * Vertical spacing between blocks in the same layer
 */
export const DEFAULT_VERTICAL_SPACING = 200

/**
 * Default offset when duplicating blocks
 */
export const DEFAULT_DUPLICATE_OFFSET = {
  x: 180,
  y: 20,
} as const

/**
 * General container padding for layout calculations
 */
export const CONTAINER_PADDING = 150

/**
 * Container horizontal padding (X offset for children in layout coordinates)
 */
export const CONTAINER_PADDING_X = 180

/**
 * Container vertical padding (Y offset for children in layout coordinates)
 */
export const CONTAINER_PADDING_Y = 100

/**
 * Root level horizontal padding
 */
export const ROOT_PADDING_X = 150

/**
 * Root level vertical padding
 */
export const ROOT_PADDING_Y = 150

/**
 * Default padding for layout positioning
 */
export const DEFAULT_LAYOUT_PADDING = { x: 150, y: 150 }

/**
 * Margin for overlap detection
 */
export const OVERLAP_MARGIN = 30

/**
 * Maximum iterations for overlap resolution
 */
export const MAX_OVERLAP_ITERATIONS = 20

/**
 * Block types excluded from autolayout
 */
export const AUTO_LAYOUT_EXCLUDED_TYPES = new Set(['note'])

/**
 * Container block types that can have children
 */
export const CONTAINER_BLOCK_TYPES = new Set(['loop', 'parallel'])

/**
 * Default layout options
 */
export const DEFAULT_LAYOUT_OPTIONS = {
  horizontalSpacing: DEFAULT_HORIZONTAL_SPACING,
  verticalSpacing: DEFAULT_VERTICAL_SPACING,
  padding: DEFAULT_LAYOUT_PADDING,
}

/**
 * Container-specific layout options (same spacing as root level for consistency)
 */
export const CONTAINER_LAYOUT_OPTIONS = {
  horizontalSpacing: DEFAULT_HORIZONTAL_SPACING,
  verticalSpacing: DEFAULT_VERTICAL_SPACING,
  padding: { x: CONTAINER_PADDING_X, y: CONTAINER_PADDING_Y },
}
