/**
 * Number of pills to display in usage indicators.
 */
export const USAGE_PILL_COUNT = 8

/**
 * Usage percentage thresholds for visual states.
 */
export const USAGE_THRESHOLDS = {
  /** Warning threshold (yellow/orange state) */
  WARNING: 75,
  /** Critical threshold (red state) */
  CRITICAL: 90,
} as const

/**
 * Color values for usage pill states using CSS variables
 */
export const USAGE_PILL_COLORS = {
  /** Unfilled pill color (gray) */
  UNFILLED: 'var(--surface-7)',
  /** Normal filled pill color (blue) */
  FILLED: 'var(--brand-secondary)',
  /** Warning state pill color (yellow/orange) */
  WARNING: 'var(--warning)',
  /** Critical/limit reached pill color (red) */
  AT_LIMIT: 'var(--text-error)',
} as const
