/**
 * Tailwind classes for brand-tile icons, built on the shared
 * `isLightTileColor` predicate. Deliberately free of any `@/blocks/registry`
 * import so the public landing `/integrations` page can use it without pulling
 * every block config and the tool registry into its bundle. Registry-backed
 * icon styling lives in `@/blocks/brand-icon`.
 */
import { isLightTileColor } from '@sim/workflow-renderer/tile-icon-color'

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
