/**
 * Utility helpers for the integrations landing pages.
 * Shared across the listing grid, individual integration cards, and slug pages.
 */

/** bgColor values that are visually light and require dark icon text. */
const LIGHT_BG = new Set(['#e0e0e0', '#f5f5f5', '#ffffff', '#ececec', '#f0f0f0'])

/**
 * Returns true when `bgColor` is a light color that requires dark foreground text.
 * Handles gradient strings safely — they always use light foreground (white).
 */
export function isLightBg(bgColor: string): boolean {
  return LIGHT_BG.has(bgColor.toLowerCase())
}
