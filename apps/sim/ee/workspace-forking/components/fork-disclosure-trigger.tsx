'use client'

import type { ReactNode } from 'react'
import { ChevronDown, cn, OverflowText } from '@sim/emcn'

interface ForkDisclosureTriggerProps {
  label: string
  expanded: boolean
  onToggle: () => void
  className: string
  labelClassName?: string
  children?: ReactNode
  trailing?: ReactNode
}

/** The common label and chevron trigger used by fork picker disclosures. */
export function ForkDisclosureTrigger({
  label,
  expanded,
  onToggle,
  className,
  labelClassName,
  children,
  trailing,
}: ForkDisclosureTriggerProps) {
  return (
    <button
      type='button'
      aria-expanded={expanded}
      className={cn('flex items-center text-left hover:text-[var(--text-primary)]', className)}
      onClick={onToggle}
    >
      <OverflowText label={label} className={labelClassName}>
        {children}
      </OverflowText>
      {trailing}
      <ChevronDown
        className={cn(
          'size-[14px] shrink-0 text-[var(--text-icon)] transition-transform',
          expanded && 'rotate-180'
        )}
      />
    </button>
  )
}
