import type { ComponentType, CSSProperties } from 'react'
import { cn } from '@sim/emcn'
import { getAllBlocks } from '@/blocks/registry'

/** A brand icon component that accepts standard styling props. */
export type StyleableIcon = ComponentType<{ className?: string; style?: CSSProperties }>

/**
 * Lazily-built lookup from a block's icon component to its theme-safe brand
 * `BlockConfig.iconColor`. Keyed by component reference so callers that
 * already hold the icon never need to thread a block type or hand-pick a
 * color. Built once on first read since the block registry is static for the
 * app's lifetime.
 */
let iconColorByComponent: Map<StyleableIcon, string> | null = null

function getIconColor(icon: StyleableIcon): string | undefined {
  if (!iconColorByComponent) {
    const map = new Map<StyleableIcon, string>()
    for (const block of getAllBlocks()) {
      if (block.iconColor) map.set(block.icon, block.iconColor)
    }
    iconColorByComponent = map
  }
  return iconColorByComponent.get(icon)
}

export interface BrandIconProps {
  /** The service's brand glyph — a block, OAuth provider, or connector icon. */
  icon: StyleableIcon
  /** Sizing and layout only; the component owns the icon's color. */
  className?: string
}

/**
 * The one bare brand glyph: a service icon drawn without its
 * `BlockConfig.bgColor` tile. Counterpart to `BlockTile`, which
 * owns the tiled treatment.
 *
 * Color is the component's, not the caller's. Single-fill icons drawn with
 * `fill='currentColor'` (Dropbox, HubSpot, …) take their registered brand
 * color; multi-color icons that hardcode their own fills (Slack, Gmail, Jira)
 * ignore it; anything with no registered color falls back to `--text-icon` so
 * a glyph never inherits an arbitrary surrounding text color.
 *
 * Reaches the block registry, so it is for workspace surfaces only — the
 * public landing `/integrations` page uses the registry-free helpers in
 * `@/blocks/icon-color` instead.
 */
export function BrandIcon({ icon: Icon, className }: BrandIconProps) {
  const color = getIconColor(Icon)
  return (
    <Icon
      className={cn('text-[var(--text-icon)]', className)}
      style={color ? { color } : undefined}
    />
  )
}

/**
 * Stable {@link BrandIcon} wrappers, keyed by the icon they wrap so repeated
 * renders hand the same component reference back and React never remounts the
 * slot it fills.
 */
const brandIconComponents = new WeakMap<StyleableIcon, ComponentType<BrandIconSlotProps>>()

export interface BrandIconSlotProps {
  /** Supplied by the host slot; sizing and layout only. */
  className?: string
}

/**
 * Adapts a brand glyph for the `icon` prop slots that take a component rather
 * than an element — `ChipModalHeader`, dropdown options, command rows — so
 * those surfaces get the same treatment as a direct {@link BrandIcon}.
 */
export function withBrandIcon(icon: StyleableIcon): ComponentType<BrandIconSlotProps> {
  const cached = brandIconComponents.get(icon)
  if (cached) return cached

  function BrandIconSlot({ className }: BrandIconSlotProps) {
    return <BrandIcon icon={icon} className={className} />
  }
  BrandIconSlot.displayName = `BrandIcon(${icon.displayName ?? icon.name ?? 'Icon'})`

  brandIconComponents.set(icon, BrandIconSlot)
  return BrandIconSlot
}
