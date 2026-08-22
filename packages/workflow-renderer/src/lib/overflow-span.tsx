import type { ReactNode } from 'react'
import { FloatingTooltip, isTextClipped, useFloatingTooltip } from '@sim/emcn'

interface OverflowSpanProps {
  value: string
  /** Full tooltip label when the visible value was shortened before rendering. */
  tooltipValue?: string
  className: string
  /**
   * Decorated rendering of `value` — the same characters, wrapped. Used to mark
   * a search hit inside a name without letting the decoration reach the
   * tooltip, which stays plain `value` so it can never leak markup or drift
   * from the text being truncated.
   */
  children?: ReactNode
}

/**
 * Truncated span that reveals its full value in a floating tooltip when — and
 * only when — the text is actually clipped. Never use a native `title`
 * attribute here: on the canvas it pops the browser's raw, unstyled tooltip
 * with the full untruncated value (including raw code/JSON) over the graph.
 */
export function OverflowSpan({ value, tooltipValue, className, children }: OverflowSpanProps) {
  const resolvedTooltipValue = tooltipValue ?? value
  const { state, handlers } = useFloatingTooltip(
    (target) => resolvedTooltipValue !== value || isTextClipped(target)
  )

  return (
    <>
      <span className={className} {...handlers}>
        {children ?? value}
      </span>
      <FloatingTooltip label={resolvedTooltipValue} state={state} />
    </>
  )
}
