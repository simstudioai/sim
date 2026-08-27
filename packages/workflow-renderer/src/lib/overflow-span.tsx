import type { ReactNode } from 'react'
import { FloatingTooltip, isTextClipped, useFloatingTooltip } from '@sim/emcn'
import type { CodePreview } from '../types'
import { CodeHoverCard } from './code-hover-card'

interface OverflowSpanProps {
  value: string
  className: string
  /** Rich content shown instead of the plain value when this is clipped code. */
  codePreview?: CodePreview
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
export function OverflowSpan({ value, className, codePreview, children }: OverflowSpanProps) {
  if (codePreview) {
    return (
      <CodeHoverCard preview={codePreview} className={className}>
        {children ?? value}
      </CodeHoverCard>
    )
  }

  return (
    <TextOverflowSpan value={value} className={className}>
      {children}
    </TextOverflowSpan>
  )
}

/** Plain clipped text keeps the platform tooltip behavior unchanged. */
function TextOverflowSpan({ value, className, children }: Omit<OverflowSpanProps, 'codePreview'>) {
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
