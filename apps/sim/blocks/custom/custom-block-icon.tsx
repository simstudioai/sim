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

  const ImageComponent = memo((props: SVGProps<SVGSVGElement>) => (
    <img src={url} alt='' className={cn('object-contain', props.className)} />
  ))
  // double-cast-allowed: an <img> renderer must satisfy the SVG-typed BlockIcon slot
  const Icon = ImageComponent as unknown as BlockIcon

  cache.set(url, Icon)
  return Icon
}

/** Fallback icon for custom blocks published without an uploaded image. */
// double-cast-allowed: a lucide icon component fills the SVG-typed BlockIcon slot
export const DefaultCustomBlockIcon: BlockIcon = Box as unknown as BlockIcon

/** Resolve a custom block's icon: the uploaded image when present, else a default glyph. */
export function getCustomBlockIcon(iconUrl: string | null | undefined): BlockIcon {
  return iconUrl ? makeImageIcon(iconUrl) : DefaultCustomBlockIcon
}
