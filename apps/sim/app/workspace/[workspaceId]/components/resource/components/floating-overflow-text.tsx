'use client'

import type React from 'react'
import { memo } from 'react'
import { cn, FloatingTooltip, isTextClipped, useFloatingTooltip, useIsOverflowing } from '@sim/emcn'

interface FloatingOverflowTextProps {
  /** Full text shown in the tooltip and used as the default visible content. */
  label: string
  /** Optional custom visible content (e.g. highlighted text); defaults to `label`. */
  children?: React.ReactNode
  className?: string
  /** Forces the tooltip even when the text is not visually clipped (e.g. content truncated upstream). */
  showWhen?: boolean
}

/**
 * Truncating text that fades its clipped edge and reveals the full value in a
 * pointer-reactive floating tooltip on hover or focus.
 */
export const FloatingOverflowText = memo(function FloatingOverflowText({
  label,
  children,
  className,
  showWhen,
}: FloatingOverflowTextProps) {
  const { ref: textRef, node, isOverflowing } = useIsOverflowing<HTMLSpanElement>()
  const { state, handlers } = useFloatingTooltip(() => {
    const element = node.current
    if (!element || label.length === 0) return false
    return Boolean(showWhen) || isTextClipped(element)
  })

  return (
    <>
      <span
        ref={textRef}
        className={cn(
          'min-w-0',
          isOverflowing &&
            '[mask-image:linear-gradient(to_right,black_calc(100%-18px),transparent)] hover:[mask-image:none] focus-visible:[mask-image:none]',
          className
        )}
        {...handlers}
      >
        {children ?? label}
      </span>
      <FloatingTooltip label={label} state={state} />
    </>
  )
})
