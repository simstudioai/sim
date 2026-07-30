/**
 * Foreground class for a brand icon rendered inside its colored block tile.
 *
 * This is a self-contained mirror of `apps/sim/lib/colors` +
 * `getTileIconColorClass` (apps/sim/blocks/icon-color.ts). The renderer package
 * is intentionally isolated and must not import app code, so the small bit of
 * brightness math it needs lives here. Keep the threshold and behavior in sync
 * with the canonical helper.
 *
 * Block icons are increasingly drawn with `fill='currentColor'`, so a tile must
 * give them a foreground that contrasts the (fixed, non-theme) brand
 * background: white on dark tiles, near-black on clearly light tiles. Hardcoded
 * multi-color icons ignore the class and keep their own fills.
 */

/** ITU-R BT.601 perceived brightness (0–1) of a `#rgb`/`#rrggbb` color, else null. */
function perceivedBrightness(color: string): number | null {
  const hex = color.trim().replace(/['"#]/g, '').toLowerCase()
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

/** Tiles brighter than this flip their icon foreground to near-black. */
const LIGHT_TILE_THRESHOLD = 0.75

/** `text-white` on dark/unknown tiles, `text-black` on clearly light tiles. */
export function tileIconColorClass(bgColor: string | null | undefined): string {
  const brightness = bgColor ? perceivedBrightness(bgColor) : null
  return brightness !== null && brightness > LIGHT_TILE_THRESHOLD ? 'text-black' : 'text-white'
}
