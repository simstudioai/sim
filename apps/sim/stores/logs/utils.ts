/**
 * Width constraints for the log details panel.
 */
export const MIN_LOG_DETAILS_WIDTH = 400
export const DEFAULT_LOG_DETAILS_WIDTH = 400
export const MAX_LOG_DETAILS_WIDTH_RATIO = 0.65

/**
 * Returns the maximum log details panel width (65vw).
 * Falls back to a reasonable default for SSR.
 */
export const getMaxLogDetailsWidth = () =>
  typeof window !== 'undefined' ? window.innerWidth * MAX_LOG_DETAILS_WIDTH_RATIO : 1040
