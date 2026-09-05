'use client'

import type { ReactNode } from 'react'
import { cn, Tooltip } from '@sim/emcn'
import type { FactSource } from '@/lib/compare/data'

export interface SourceLinkProps {
  source: FactSource
  children: ReactNode
  /** Additional classes for the trigger element (the visible value/title). */
  className?: string
}

/**
 * Uses the visible value or title as the citation target to keep dense tables
 * and cards compact. The tooltip includes the source label and review date.
 */
export function SourceLink({ source, children, className }: SourceLinkProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <a
          href={source.url}
          target='_blank'
          rel='noopener noreferrer'
          aria-label={`${source.label} (opens source)`}
          className={cn('block min-w-0', className)}
        >
          {children}
        </a>
      </Tooltip.Trigger>
      <Tooltip.Content>
        Source: {source.label} · Checked {source.asOf}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
