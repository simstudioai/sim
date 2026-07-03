'use client'

import type { ReactNode } from 'react'
import { Tooltip } from '@sim/emcn'
import type { FactSource } from '@/lib/compare/data'

export interface SourceLinkProps {
  source: FactSource
  children: ReactNode
  /** Additional classes for the trigger element (the visible value/title). */
  className?: string
}

/**
 * Wraps a fact's visible value (or a card's title) so hovering it directly
 * shows a one-line "Source: X" tooltip, and clicking it opens the source,
 * rather than a separate info-icon affordance next to every value. One
 * hover/click target per fact instead of two keeps the dense comparison
 * table and card lists from reading as icon-cluttered. Every {@link FactSource}
 * carries a real, publicly reachable URL (enforced by the type), so this
 * always renders as a link.
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
          className={className}
        >
          {children}
        </a>
      </Tooltip.Trigger>
      <Tooltip.Content>Source: {source.label}</Tooltip.Content>
    </Tooltip.Root>
  )
}
