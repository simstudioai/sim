/**
 * Width constraints for the log details panel.
 *
 * The min is the floor below which the panel becomes unusable. On narrow
 * viewports (e.g. tablets, side-by-side windows, Mothership task pages with
 * a constrained content area) the viewport-ratio cap is what actually wins
 * — `getMaxLogDetailsWidth` enforces this. We never let the floor exceed
 * the cap, so the panel always leaves room for the surface behind it.
 */
export const MIN_LOG_DETAILS_WIDTH = 320
export const DEFAULT_LOG_DETAILS_WIDTH = 520
export const MAX_LOG_DETAILS_WIDTH_RATIO = 0.6

/**
 * Returns the maximum log details panel width (60% of viewport width).
 * Falls back to a reasonable default for SSR.
 */
export const getMaxLogDetailsWidth = () =>
  typeof window !== 'undefined' ? window.innerWidth * MAX_LOG_DETAILS_WIDTH_RATIO : 1040

/**
 * Clamps a width value to the valid panel range for the current viewport.
 * The floor (`MIN_LOG_DETAILS_WIDTH`) is itself capped by the viewport ratio
 * so a small viewport never produces a panel that covers more than 60vw.
 */
export const clampPanelWidth = (width: number) => {
  const max = getMaxLogDetailsWidth()
  const min = Math.min(MIN_LOG_DETAILS_WIDTH, max)
  return Math.max(min, Math.min(width, max))
}
