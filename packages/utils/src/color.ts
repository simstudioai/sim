/**
 * Perceived brightness (0 = black, 1 = white) of a CSS color, using the ITU-R
 * BT.601 (YIQ) luma weights `0.299 R + 0.587 G + 0.114 B`.
 *
 * This is the perceptual "is it light or dark" measure the product uses for
 * foreground/background contrast decisions. It tracks human brightness
 * perception better than gamma-corrected relative luminance for the saturated
 * brand colors used as tile backgrounds (e.g. it correctly reads bright yellows
 * as light), which is why every contrast helper builds on it.
 *
 * Accepts `#rgb`/`#rrggbb` hex (with or without `#`, optionally quoted) and the
 * `white`/`black` keywords. Returns `null` for anything else (named colors,
 * gradients, `currentColor`, malformed input) so callers can treat unknown
 * values explicitly instead of guessing.
 *
 * Lives here rather than in `apps/sim` because the canvas renderer package needs
 * the same answer and may not import app code. A second copy there drifted on
 * the `white`/`black` keywords, which is invisible until a block ships one as
 * its tile color and its icon renders white-on-white on the canvas only.
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
