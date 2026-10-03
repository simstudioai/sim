'use client'

import { memo } from 'react'
import { cn, FloatingTooltip, isTextClipped, useFloatingTooltip } from '@sim/emcn'

interface HeaderLabelProps {
  label: string
  className?: string
}

/**
 * Column header text that clips with an ellipsis and reveals its full value in
 * a floating tooltip — but only while actually clipped, since an untruncated
 * header already says everything the tooltip would.
 */
export const HeaderLabel = memo(function HeaderLabel({ label, className }: HeaderLabelProps) {
  const { state, handlers } = useFloatingTooltip(isTextClipped)

  return (
    <>
      <span className={cn('min-w-0 truncate', className)} {...handlers}>
        {label}
      </span>
      <FloatingTooltip label={label} state={state} />
    </>
  )
})
