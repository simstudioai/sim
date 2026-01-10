/**
 * Width constraints for the log details panel.
 */
export const MIN_LOG_DETAILS_WIDTH = 400
export const DEFAULT_LOG_DETAILS_WIDTH = 400

/**
 * Returns the maximum log details panel width (50vw).
 * Falls back to a reasonable default for SSR.
 */
export const getMaxLogDetailsWidth = () =>
  typeof window !== 'undefined' ? window.innerWidth * 0.5 : 800
