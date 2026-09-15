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
 * Keeps prose citations inline, with source metadata on hover or focus and a
 * visible check date on devices whose primary pointer cannot hover.
 */
export function SourceLink({ source, children, className }: SourceLinkProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <a
          href={source.url}
          target='_blank'
          rel='noopener noreferrer'
          className={cn('relative block min-w-0', className)}
        >
          {children}
          <span className='sr-only'>
            {' '}
            (source: {source.label}, checked {source.asOf}, opens in a new tab)
          </span>
        </a>
      </Tooltip.Trigger>
      <span
        className='ml-1 whitespace-nowrap text-[var(--text-muted)] text-caption [@media(hover:hover)]:hidden'
        aria-hidden='true'
      >
        (checked <time dateTime={source.asOf}>{source.asOf}</time>)
      </span>
      <Tooltip.Content>
        Source: {source.label} · Checked {source.asOf}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
