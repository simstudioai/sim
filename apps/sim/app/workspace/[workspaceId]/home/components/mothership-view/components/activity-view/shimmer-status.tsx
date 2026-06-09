'use client'

import { cn } from '@/lib/core/utils/cn'
import styles from './shimmer-status.module.css'

interface ShimmerStatusProps {
  /** The single status line. Swapping it crossfades to the new text. */
  text: string
  /** Animate the shimmer sweep (true while working; false when paused/idle). */
  active?: boolean
  className?: string
}

/**
 * A single shimmering status line that changes as work progresses — the entire
 * in-progress chat surface. Deliberately replaces the broken-out agent lanes /
 * tool rows: one line, no bullets, no stacking. Re-keys on `text` so each new
 * phrase fades in.
 */
export function ShimmerStatus({ text, active = true, className }: ShimmerStatusProps) {
  return (
    <span
      key={text}
      className={cn(
        styles.shimmer,
        active && styles.active,
        'inline-block animate-stream-fade-in text-[15px] leading-[24px]',
        className
      )}
    >
      {text}
    </span>
  )
}
