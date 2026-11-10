'use client'

import { LRUCache } from 'lru-cache'
import styles from '@/app/(product)/_components/workspace/workflows/canvas/block-tile/custom-block-tile.module.css'
import {
  type BlockIcon,
  Box,
  CUSTOM_BLOCK_IMAGE_TILE_COLOR,
  CUSTOM_BLOCK_TILE_COLOR,
} from '@/platform/lib/data/workflows'

/** Distinct custom-block images a session keeps components for; an evicted one is rebuilt on use. */
const MAX_IMAGE_ICONS = 500

const imageIcons = new LRUCache<string, BlockIcon>({ max: MAX_IMAGE_ICONS })

/**
 * A block icon drawn from an uploaded image. Cached by URL so every node and tile of the same custom
 * block shares one component. It fills its tile unless a caller's class sizes it.
 */
function imageIcon(url: string): BlockIcon {
  const cached = imageIcons.get(url)
  if (cached) return cached
  const ImageIcon: BlockIcon = ({ className }) => (
    <img src={url} alt='' className={className ? `${styles.image} ${className}` : styles.image} />
  )
  imageIcons.set(url, ImageIcon)
  return ImageIcon
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
