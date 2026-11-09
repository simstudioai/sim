/**
 * The contour weight every drawn resource graphic shares.
 *
 * Matches the tables grid's 1px `--border` rules and the knowledge mark's thinned
 * strokes — the graphics sit a nav level apart, so a heavier outline on any one of
 * them reads as a different illustration system.
 *
 * Fills stay near the top of the surface ramp for the same reason: the border draws
 * the shape and the fill only has to separate one layer from the next.
 */
export const HAIRLINE = {
  stroke: 'var(--border)',
  strokeWidth: 1.1,
  strokeLinejoin: 'round' as const,
} as const
