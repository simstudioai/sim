import type { ReactNode } from 'react'
import { FloatingTooltip, isTextClipped, useFloatingTooltip } from '@sim/emcn'

interface OverflowSpanProps {
  value: string
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
export function OverflowSpan({ value, className, children }: OverflowSpanProps) {
  const { state, handlers } = useFloatingTooltip(isTextClipped)

  return (
    <>
      <span className={className} {...handlers}>
        {children ?? value}
      </span>
      <FloatingTooltip label={value} state={state} />
    </>
  )
}
