import { perceivedBackgroundBrightness } from '@sim/utils/color'

/**
 * Foreground class for a brand icon rendered inside its colored block tile.
 *
 * The brightness maths is `@sim/utils/color`, shared with `@/blocks/icon-color`,
 * so the canvas and the rest of the app can never disagree about which tiles are
 * light. Only the threshold lives here, and it matches that helper's.
 *
 * Block icons are increasingly drawn with `fill='currentColor'`, so a tile must
 * give them a foreground that contrasts the (fixed, non-theme) brand
 * background: white on dark tiles, near-black on clearly light tiles. Hardcoded
 * multi-color icons ignore the class and keep their own fills.
 */

/** Tiles brighter than this flip their icon foreground to near-black. */
const LIGHT_TILE_THRESHOLD = 0.75

/** Whether a provider tile needs dark foreground content for legibility. */
export function isLightTileColor(bgColor: string | null | undefined): boolean {
  const brightness = bgColor ? perceivedBackgroundBrightness(bgColor) : null
  return brightness !== null && brightness > LIGHT_TILE_THRESHOLD
}
