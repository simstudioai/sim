import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@sim/emcn'

/** Canonical vignette box. Every resource graphic is drawn on this 320x148 stage. */
export const VIGNETTE_WIDTH = 320
export const VIGNETTE_HEIGHT = 148

/**
 * Edge falloff shared by every resource empty-state graphic.
 *
 * The editor vignette fades its connection strokes to zero opacity at the frame
 * edge so the workflow reads as continuing off-canvas. These graphics carry
 * skeleton geometry rather than strokes, so the same falloff is applied as a
 * mask over the whole stage — the miniature is a window onto something larger,
 * not a sticker with a hard border.
 */
const VIGNETTE_MASK =
  '[mask-image:linear-gradient(to_right,transparent_0%,black_16%,black_84%,transparent_100%),linear-gradient(to_bottom,transparent_0%,black_18%,black_78%,transparent_100%)] [mask-composite:intersect] [-webkit-mask-composite:source-in]'

interface VignetteProps {
  children: ReactNode
  className?: string
}

/**
 * Decorative stage for a resource empty-state graphic.
 *
 * Fixed size so every resource page's empty state occupies identical space, and
 * `aria-hidden` throughout — the adjacent title and description carry all of the
 * meaning.
 */
export function Vignette({ children, className }: VignetteProps) {
  return (
    <div
      aria-hidden='true'
      className={cn(
        'relative h-[148px] w-[320px] overflow-hidden text-[var(--text-icon)]',
        VIGNETTE_MASK,
        className
      )}
    >
      {children}
    </div>
  )
}

interface BarProps {
  className?: string
  /** Escape hatch for computed geometry (widths driven by data arrays). */
  style?: CSSProperties
}

/** Skeleton bar — the neutral stand-in for content inside a miniature. */
export function Bar({ className, style }: BarProps) {
  return (
    <span className={cn('block rounded-[3px] bg-[var(--surface-4)]', className)} style={style} />
  )
}
