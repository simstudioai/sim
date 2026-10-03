'use client'

import { memo, type SVGProps } from 'react'
import { cn } from '@sim/emcn'
import { Box } from '@sim/emcn/icons'
import {
  CUSTOM_BLOCK_IMAGE_TILE_COLOR,
  CUSTOM_BLOCK_TILE_COLOR,
} from '@/blocks/custom/build-config'
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
export const DefaultCustomBlockIcon: BlockIcon = Box

/**
 * Resolve a custom block's icon and the tile it sits on: the uploaded image, else
 * the org's whitelabel logo (`fallbackUrl`), else the default glyph. Both fall out
 * of the same precedence, so a block can never paint a tile its icon disagrees with.
 */
export function getCustomBlockTile(
  iconUrl: string | null | undefined,
  fallbackUrl?: string | null
): { icon: BlockIcon; bgColor: string } {
  const url = iconUrl || fallbackUrl
  return url
    ? { icon: makeImageIcon(url), bgColor: CUSTOM_BLOCK_IMAGE_TILE_COLOR }
    : { icon: DefaultCustomBlockIcon, bgColor: CUSTOM_BLOCK_TILE_COLOR }
}

/** The icon half of {@link getCustomBlockTile}, for surfaces that paint no tile. */
export function getCustomBlockIcon(
  iconUrl: string | null | undefined,
  fallbackUrl?: string | null
): BlockIcon {
  return getCustomBlockTile(iconUrl, fallbackUrl).icon
}
