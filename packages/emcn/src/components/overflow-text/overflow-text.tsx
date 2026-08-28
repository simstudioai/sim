'use client'

import type { ReactNode } from 'react'
import { memo, useCallback } from 'react'
import { cn } from '../../lib/cn'
import {
  FloatingTooltip,
  isTextClipped,
  useFloatingTooltip,
  useIsOverflowing,
} from '../tooltip/tooltip'

/** Complete fade-only clipping treatment for measured special cases. */
export const overflowTextFadeClass =
  'overflow-hidden text-clip whitespace-nowrap [-webkit-mask-image:linear-gradient(to_right,black_calc(100%_-_18px),transparent)] [mask-image:linear-gradient(to_right,black_calc(100%_-_18px),transparent)]'

/** Fade-free clipping for externally measured labels and rich-content overflow exceptions. */
export const overflowTextClipClass = 'block min-w-0 overflow-hidden text-clip whitespace-nowrap'

export interface OverflowTextProps {
  /** Full text shown in the tooltip and used as the default visible content. */
  label: string
  /** Decorated rendering of `label`; the tooltip always keeps the plain label. */
  children?: ReactNode
  /** Layout and typography only; truncation and fade chrome are owned here. */
  className?: string
  /** Forces the tooltip when the visible label was shortened before rendering. */
  showWhen?: boolean
  /** Whether the full-value tooltip may open. Disable for visual mirror layers. */
  tooltipEnabled?: boolean
  /** Lets the nearest interactive ancestor own keyboard focus for this label. */
  focusTarget?: 'nearest-interactive'
}

/**
 * A single-line, read-only label that fades only when clipped and exposes its
 * complete value in the platform floating tooltip.
 *
 * Use this for human-readable names and titles in constrained chrome. Keep
 * editable values, code, logs, paths, dense grids, and multiline copy on their
 * purpose-built overflow behavior.
 */
export const OverflowText = memo(function OverflowText({
  label,
  children,
  className,
  showWhen,
  tooltipEnabled = true,
  focusTarget,
}: OverflowTextProps) {
  const { ref: textRef, node, isOverflowing } = useIsOverflowing<HTMLSpanElement>(children ?? label)
  const tooltipEligible = tooltipEnabled && label.length > 0 && (Boolean(showWhen) || isOverflowing)
  const getFocusTarget = useCallback(() => {
    if (focusTarget !== 'nearest-interactive') return null
    return (
      node.current?.closest<HTMLElement>(
        'a[href], button, [role="button"], [role^="menuitem"], [tabindex]:not([tabindex="-1"])'
      ) ?? null
    )
  }, [focusTarget, node])
  const { state, handlers } = useFloatingTooltip(
    () => {
      const element = node.current
      if (!tooltipEnabled || !element || label.length === 0) return false
      return Boolean(showWhen) || isTextClipped(element)
    },
    {
      getFocusTarget: focusTarget === 'nearest-interactive' ? getFocusTarget : undefined,
      revalidateKey: tooltipEligible,
    }
  )

  return (
    <>
      <span
        ref={textRef}
        data-overflow-text=''
        className={cn(className, overflowTextClipClass, isOverflowing && overflowTextFadeClass)}
        {...handlers}
      >
        {children ?? label}
      </span>
      <FloatingTooltip label={label} state={state} />
    </>
  )
})
