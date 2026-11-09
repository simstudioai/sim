'use client'

import { memo, type SVGProps } from 'react'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/canvas/block-tile/custom-block-tile.module.css'
import {
  type BlockIcon,
  Box,
  CUSTOM_BLOCK_IMAGE_TILE_COLOR,
  CUSTOM_BLOCK_TILE_COLOR,
} from '@/platform/lib/data/workflows'

const imageIcons = new Map<string, BlockIcon>()

/**
 * A block icon drawn from an uploaded image. Cached by URL so every node and tile of the same custom
 * block shares one component. It fills its tile unless a caller's class sizes it.
 */
function imageIcon(url: string): BlockIcon {
  const cached = imageIcons.get(url)
  if (cached) return cached
  const ImageIcon = memo(({ className }: SVGProps<SVGSVGElement>) => (
    <img src={url} alt='' className={className ? `${styles.image} ${className}` : styles.image} />
  ))
  // double-cast-allowed: an <img> renderer must satisfy the SVG-typed BlockIcon slot, as in legacy
  const icon = ImageIcon as unknown as BlockIcon
  imageIcons.set(url, icon)
  return icon
}

/**
 * A custom block's icon and the tile under it: the uploaded image, else the organization's logo,
 * else the default glyph, so a block never paints a tile its icon disagrees with.
 */
export function getCustomBlockTile(
  iconUrl: string | null | undefined,
  fallbackUrl?: string | null
): { icon: BlockIcon; bgColor: string } {
  const url = iconUrl || fallbackUrl
  return url
    ? { icon: imageIcon(url), bgColor: CUSTOM_BLOCK_IMAGE_TILE_COLOR }
    : { icon: Box, bgColor: CUSTOM_BLOCK_TILE_COLOR }
}
