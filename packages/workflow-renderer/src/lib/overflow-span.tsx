import { FloatingTooltip, isTextClipped, useFloatingTooltip } from '@sim/emcn'

interface OverflowSpanProps {
  value: string
  className: string
}

/**
 * Truncated span that reveals its full value in a floating tooltip when — and
 * only when — the text is actually clipped. Never use a native `title`
 * attribute here: on the canvas it pops the browser's raw, unstyled tooltip
 * with the full untruncated value (including raw code/JSON) over the graph.
 */
export function OverflowSpan({ value, className }: OverflowSpanProps) {
  const { state, handlers } = useFloatingTooltip(isTextClipped)

  return (
    <>
      <span className={className} {...handlers}>
        {value}
      </span>
      <FloatingTooltip label={value} state={state} />
    </>
  )
}
