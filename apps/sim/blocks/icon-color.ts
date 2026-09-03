/**
 * Contrast helpers for brand tiles. Pure colour maths — deliberately free of any
 * `@/blocks/registry` import so the public landing `/integrations` page can use
 * these without pulling 282 block configs and the tool registry into its bundle.
 * Registry-backed icon styling lives in `@/blocks/brand-icon`.
 */
import { perceivedBackgroundBrightness } from '@sim/utils/color'

/**
 * Brightness above which a brand tile is "clearly light" and a white foreground
 * icon would wash out. Set deliberately high (0.75) so only genuinely light
 * tiles flip their icon to dark: it keeps monochrome `currentColor` icons
 * legible on their pale tiles (Notion/Mailchimp/Infisical sit at ~0.83+) while
 * leaving mid-bright saturated brand tiles (HubSpot orange, amber notes) on the
 * white icon they have always used — avoiding a needless app-wide recolor.
 */
const LIGHT_TILE_THRESHOLD = 0.75

/**
 * True when a block's {@link BlockConfig.bgColor} tile is light enough that a
 * white foreground icon would wash out. Gradients use the average brightness
 * of their supported color stops; unknown values are treated as dark.
 */
export function isLightTileColor(bgColor: string | null | undefined): boolean {
  const brightness = bgColor ? perceivedBackgroundBrightness(bgColor) : null
  return brightness !== null && brightness > LIGHT_TILE_THRESHOLD
}

/**
 * Tailwind foreground class for a brand icon rendered inside its
 * {@link BlockConfig.bgColor} tile. Dark tiles get white; light tiles get
 * near-black so monochrome `currentColor` icons (Notion, Mailchimp, …) stay
 * legible instead of rendering white-on-white. Hardcoded multi-color icons
 * ignore the class and keep their own fills. Pass `important` when overriding
 * an inherited text color (the legacy `text-white!` tile rows).
 *
 * All four literals are spelled out so Tailwind's JIT scanner emits them.
 */
export function getTileIconColorClass(
  bgColor: string | null | undefined,
  important = false
): string {
  if (isLightTileColor(bgColor)) return important ? 'text-black!' : 'text-black'
  return important ? 'text-white!' : 'text-white'
}
