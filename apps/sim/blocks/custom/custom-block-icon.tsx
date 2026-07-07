'use client'

import { memo, type SVGProps } from 'react'
import { cn } from '@sim/emcn'
import { Box } from 'lucide-react'
import type { BlockIcon } from '@/blocks/types'

/**
 * Build a `BlockIcon` from an uploaded icon image URL. Rendered as an `<img>` so
 * any uploaded PNG/JPEG/SVG works; `className` (size) is forwarded like every
 * other block icon. Cached by URL so the component reference stays stable across
 * the many tiles/nodes that render a custom block.
 */
const cache = new Map<string, BlockIcon>()

export function makeImageIcon(url: string): BlockIcon {
  const cached = cache.get(url)
  if (cached) return cached

  // Fill the tile so an uploaded image/logo reads at the same footprint as other
  // blocks' colored tiles, instead of a small glyph floating in a transparent
  // square. Trailing `size-full` beats a consumer size *class* (twMerge keeps the
  // last of a conflict group) so a tiled surface (canvas/toolbar/palette) fills;
  // it loses to a consumer inline `style` (specificity) so a tile-less inline
  // surface that sizes via `style={{ width, height }}` still renders at its px.
  const ImageComponent = memo(({ className, style }: SVGProps<SVGSVGElement>) => (
    <img
      src={url}
      alt=''
      style={style}
      className={cn('rounded-[4px] object-contain', className, 'size-full')}
    />
  ))
  // double-cast-allowed: an <img> renderer must satisfy the SVG-typed BlockIcon slot
  const Icon = ImageComponent as unknown as BlockIcon

  cache.set(url, Icon)
  return Icon
}

/** Fallback icon for custom blocks published without an uploaded image. */
// double-cast-allowed: a lucide icon component fills the SVG-typed BlockIcon slot
export const DefaultCustomBlockIcon: BlockIcon = Box as unknown as BlockIcon

/**
 * Resolve a custom block's icon: the uploaded image, else the org's whitelabel logo
 * (`fallbackUrl`), else the default glyph.
 */
export function getCustomBlockIcon(
  iconUrl: string | null | undefined,
  fallbackUrl?: string | null
): BlockIcon {
  const url = iconUrl || fallbackUrl
  return url ? makeImageIcon(url) : DefaultCustomBlockIcon
}
