'use client'

import { memo, type SVGProps } from 'react'
import { cn } from '@sim/emcn'
import { Box } from 'lucide-react'
import type { BlockIcon } from '@/blocks/types'

const cache = new Map<string, BlockIcon>()

/**
 * Build a `BlockIcon` from an uploaded icon image URL. Rendered as an `<img>` so
 * any uploaded PNG/JPEG/SVG works; `className` (size) is forwarded like every
 * other block icon. Cached by URL so the component reference stays stable across
 * the many tiles/nodes that render a custom block.
 */
export function makeImageIcon(url: string): BlockIcon {
  const cached = cache.get(url)
  if (cached) return cached

  /**
   * `size-full` is only the DEFAULT (fills a fixed-size tile parent when no size
   * is given); a consumer size class or inline style always wins, so flow
   * surfaces that render icons at `size-[14px]` get exactly that. Tiled surfaces
   * (canvas node, toolbar, search modal, …) pass a glyph-size class but want the
   * image to fill the tile — they opt in with `[&_img]:size-full` on the fixed
   * wrapper, which out-specifies the size class on the img.
   */
  const ImageComponent = memo(({ className, style }: SVGProps<SVGSVGElement>) => (
    <img
      src={url}
      alt=''
      style={style}
      className={cn('size-full rounded-[4px] object-contain', className)}
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
