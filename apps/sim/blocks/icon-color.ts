import type { ComponentType, CSSProperties } from 'react'
import { isLightColor } from '@/lib/colors'
import { getAllBlocks } from '@/blocks/registry'

/** A brand icon component that accepts standard styling props. */
export type StyleableIcon = ComponentType<{ className?: string; style?: CSSProperties }>

/**
 * Lazily-built lookup from a block's icon component to its theme-safe brand
 * {@link BlockConfig.iconColor}. Keyed by component reference so callers that
 * already hold the icon (suggested actions, credential pickers, …) never need
 * to thread a block type or hand-pick a color. Built once on first read since
 * the block registry is static for the app's lifetime.
 */
let iconColorByComponent: Map<StyleableIcon, string> | null = null

function getIconColorMap(): Map<StyleableIcon, string> {
  if (iconColorByComponent) return iconColorByComponent
  const map = new Map<StyleableIcon, string>()
  for (const block of getAllBlocks()) {
    if (block.iconColor) map.set(block.icon, block.iconColor)
  }
  iconColorByComponent = map
  return map
}

/**
 * Inline `style` for rendering a brand icon bare (without its colored tile
 * background): the block's theme-safe {@link BlockConfig.iconColor} as `color`,
 * or `undefined` when none is defined so the caller keeps its own default
 * icon styling.
 *
 * Single-fill icons drawn with `fill='currentColor'` (e.g. HubSpot) adopt the
 * color; multi-color brand icons that hardcode their own fills (Slack, Gmail,
 * Jira, Salesforce, Google Calendar) ignore it and keep their own colors.
 */
export function getBareIconStyle(icon: StyleableIcon): CSSProperties | undefined {
  const color = getIconColorMap().get(icon)
  return color ? { color } : undefined
}

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
 * white foreground icon would wash out. Gradients and unknown values are
 * treated as dark (the common case for brand tiles).
 */
export function isLightTileColor(bgColor: string | null | undefined): boolean {
  return Boolean(bgColor) && isLightColor(bgColor as string, LIGHT_TILE_THRESHOLD)
}

/**
 * Tailwind foreground class for a brand icon rendered inside its
 * {@link BlockConfig.bgColor} tile. Dark tiles get white; light tiles get
 * near-black so monochrome `currentColor` icons (Notion, Mailchimp, …) stay
 * legible instead of rendering white-on-white. Hardcoded multi-color icons
 * ignore the class and keep their own fills. Pass `important` when overriding
 * an inherited text color (the legacy `!text-white` tile rows).
 *
 * All four literals are spelled out so Tailwind's JIT scanner emits them.
 */
export function getTileIconColorClass(
  bgColor: string | null | undefined,
  important = false
): string {
  if (isLightTileColor(bgColor)) return important ? '!text-black' : 'text-black'
  return important ? '!text-white' : 'text-white'
}
