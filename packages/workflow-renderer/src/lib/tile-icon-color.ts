import { perceivedBackgroundBrightness } from '@sim/utils/color'

/**
 * Foreground class for a brand icon rendered inside its colored block tile.
 *
 * The single source of truth for which tiles are light: the canvas renders with it
 * and the app's `@/blocks/icon-color` builds its Tailwind classes on it, so the two
 * can never disagree. It imports only `@sim/utils/color`, keeping the landing
 * bundle that reaches it through `@/blocks/icon-color` light.
 *
 * Block icons are increasingly drawn with `fill='currentColor'`, so a tile must
 * give them a foreground that contrasts the (fixed, non-theme) brand
 * background: white on dark tiles, near-black on clearly light tiles. Hardcoded
 * multi-color icons ignore the class and keep their own fills.
 */

/**
 * Tiles brighter than this flip their icon foreground to near-black. Set
 * deliberately high so only genuinely light tiles (Notion, Mailchimp, Infisical
 * sit at ~0.83+) flip, while mid-bright saturated brand tiles (HubSpot orange,
 * amber notes) keep the white icon they have always used.
 */
const LIGHT_TILE_THRESHOLD = 0.75

/** Whether a provider tile needs dark foreground content for legibility. */
export function isLightTileColor(bgColor: string | null | undefined): boolean {
  const brightness = bgColor ? perceivedBackgroundBrightness(bgColor) : null
  return brightness !== null && brightness > LIGHT_TILE_THRESHOLD
}
