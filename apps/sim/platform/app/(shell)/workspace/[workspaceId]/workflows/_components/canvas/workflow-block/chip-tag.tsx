import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { cn } from '@sim/emcn/lib/cn'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/canvas/workflow-block/chip-tag.module.css'

/**
 * The block-kind tones a `workflow` tag paints: fixed brand fills, identical in both themes.
 * `neutral` is the only outlined tone (white with an inset ring).
 */
export type ChipTagTone =
  | 'neutral'
  | 'inverse'
  | 'ash'
  | 'orange'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'purple'
  | 'identity'
  | 'content'

/** The tag's paint: a role tone, a provider brand fill, or the neutral `mono` surface. */
export type ChipTagPaint =
  | { variant: 'workflow'; tone: ChipTagTone }
  | { variant: 'brand'; brandColor: string; brandForeground: 'light' | 'dark' }
  | { variant: 'mono' }

/**
 * The few shapes the canvas gives the tag, each the legacy `className` merged over the base:
 * `square` is the 20px Disabled/Locked mark, `tag` the header's kind tag, `inline` a sentence value
 * chip, `tile-*` the accent block tile at its three sizes.
 */
export type ChipTagLayout = 'square' | 'tag' | 'inline' | 'tile-lg' | 'tile-md' | 'tile-sm'

interface ChipTagProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, 'children' | 'style' | 'className'> {
  paint: ChipTagPaint
  layout?: ChipTagLayout
  /** Half opacity, as a disabled block's header tag. */
  dimmed?: boolean
  /** Placeholder ink, as an inline chip showing its field's noun. */
  muted?: boolean
  children: ReactNode
}

const LAYOUT_CLASS: Record<ChipTagLayout, string | undefined> = {
  square: styles.square,
  tag: styles.tag,
  inline: styles.inline,
  'tile-lg': cn(styles.tile, styles.tileLg),
  'tile-md': styles.tile,
  'tile-sm': cn(styles.tile, styles.tileSm),
}

/**
 * The legacy 20px `ChipTag` exactly as the canvas paints it: block-kind tags, the Disabled and
 * Locked marks, the sentence's inline value chips and accent block tiles.
 */
export function ChipTag({ paint, layout, dimmed, muted, children, ...props }: ChipTagProps) {
  const resolved = resolvePaint(paint)
  return (
    <span
      className={cn(
        styles.chip,
        resolved.className,
        layout && LAYOUT_CLASS[layout],
        dimmed && styles.dimmed,
        muted && styles.muted
      )}
      style={resolved.style}
      {...props}
    >
      {children}
    </span>
  )
}

function resolvePaint(paint: ChipTagPaint): {
  className: string | undefined
  style?: CSSProperties
} {
  if (paint.variant === 'workflow') return { className: styles[paint.tone] }
  if (paint.variant === 'brand') {
    return {
      className: paint.brandForeground === 'dark' ? styles.brandDark : styles.brandLight,
      style: { background: paint.brandColor },
    }
  }
  return { className: styles.mono }
}
