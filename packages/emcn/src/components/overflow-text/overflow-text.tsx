'use client'

import type { ReactNode } from 'react'
import { memo } from 'react'
import { cn } from '../../lib/cn'
import {
  FloatingTooltip,
  isTextClipped,
  useFloatingTooltip,
  useIsOverflowing,
} from '../tooltip/tooltip'

/** Shared 18px trailing fade for measured special cases such as breadcrumb groups. */
export const overflowTextFadeClass =
  '[-webkit-mask-image:linear-gradient(to_right,black_calc(100%_-_18px),transparent)] [mask-image:linear-gradient(to_right,black_calc(100%_-_18px),transparent)]'

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
  /** External composite control whose keyboard focus should reveal the tooltip. */
  focusTarget?: HTMLElement | null
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
  const { ref: textRef, node, isOverflowing } = useIsOverflowing<HTMLSpanElement>(label)
  const tooltipEligible = tooltipEnabled && label.length > 0 && (Boolean(showWhen) || isOverflowing)
  const { state, handlers } = useFloatingTooltip(
    () => {
      const element = node.current
      if (!tooltipEnabled || !element || label.length === 0) return false
      return Boolean(showWhen) || isTextClipped(element)
    },
    { focusTarget, revalidateKey: tooltipEligible }
  )

  return (
    <>
      <span
        ref={textRef}
        data-overflow-text=''
        className={cn(
          className,
          'min-w-0 overflow-hidden text-clip whitespace-nowrap',
          isOverflowing && overflowTextFadeClass
        )}
        {...handlers}
      >
        {children ?? label}
      </span>
      <FloatingTooltip label={label} state={state} />
    </>
  )
})
