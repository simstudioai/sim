/**
 * Perceived brightness (0 = black, 1 = white) of a CSS color, using the ITU-R
 * BT.601 (YIQ) luma weights `0.299 R + 0.587 G + 0.114 B`.
 *
 * This is the perceptual "is it light or dark" measure the app uses for
 * foreground/background contrast decisions. It tracks human brightness
 * perception better than gamma-corrected relative luminance for the saturated
 * brand colors used as tile backgrounds (e.g. it correctly reads bright yellows
 * as light), which is why every contrast helper in the app builds on it.
 *
 * Accepts `#rgb`/`#rrggbb` hex (with or without `#`, optionally quoted) and the
 * `white`/`black` keywords. Returns `null` for anything else (named colors,
 * gradients, `currentColor`, malformed input) so callers can treat unknown
 * values explicitly instead of guessing.
 */
export function perceivedBrightness(color: string): number | null {
  const value = color.trim().replace(/['"]/g, '').toLowerCase()
  if (value === 'white') return 1
  if (value === 'black') return 0
  const hex = value.replace('#', '')
  let r: number
  let g: number
  let b: number
  if (/^[0-9a-f]{3}$/.test(hex)) {
    r = Number.parseInt(hex[0] + hex[0], 16)
    g = Number.parseInt(hex[1] + hex[1], 16)
    b = Number.parseInt(hex[2] + hex[2], 16)
  } else if (/^[0-9a-f]{6}$/.test(hex)) {
    r = Number.parseInt(hex.slice(0, 2), 16)
    g = Number.parseInt(hex.slice(2, 4), 16)
    b = Number.parseInt(hex.slice(4, 6), 16)
  } else {
    return null
  }
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}

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
