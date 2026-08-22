import { perceivedBrightness } from '@sim/utils/color'

/**
 * True when `color` is light enough that a white foreground would wash out.
 * Non-color values (gradients, `currentColor`, unknown) are treated as not
 * light. `threshold` is the perceived-brightness cutoff (default 0.6, tuned so
 * only clearly light tiles flip to a dark foreground).
 */
export function isLightColor(color: string, threshold = 0.6): boolean {
  const brightness = perceivedBrightness(color)
  return brightness !== null && brightness > threshold
}

/**
 * True when `color` is dark enough to warrant a light foreground. Non-color
 * values (gradients, `currentColor`, unknown) are treated as not dark.
 * `threshold` is the perceived-brightness cutoff (default 0.5, the conventional
 * midpoint for binary text contrast).
 */
export function isDarkColor(color: string, threshold = 0.5): boolean {
  const brightness = perceivedBrightness(color)
  return brightness !== null && brightness < threshold
}

/**
 * Black or white — whichever reads on top of `color`. Dark colors get white
 * text; light colors (and unparseable values) get black. Uses the 0.5 midpoint
 * ({@link isDarkColor}'s default), the conventional binary text-contrast cutoff.
 *
 * Note this is intentionally a different cutoff than the brand-tile *icon*
 * decision ({@link isLightColor}'s 0.6 default, raised to 0.75 for tiles), which
 * biases toward white more aggressively: a colored tile reads better with a
 * white icon until it is clearly light, whereas plain text wants the
 * mathematically closer of black/white. The two helpers therefore answer
 * "what foreground reads here" differently by design, per surface.
 */
export function getContrastTextColor(color: string): '#000000' | '#ffffff' {
  return isDarkColor(color) ? '#ffffff' : '#000000'
}
