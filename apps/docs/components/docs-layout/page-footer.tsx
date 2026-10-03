import type { ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from '@sim/emcn/icons'
import Link from 'next/link'

interface PageNeighbour {
  url: string
  name: ReactNode
}

interface PageFooterProps {
  previous?: PageNeighbour
  next?: PageNeighbour
}

/**
 * Sequential page navigation. The destination name carries the meaning, so each
 * card shows it alone with a direction chevron — the chevron already says which
 * way you are going, and a "Previous"/"Next" label above the name only repeated
 * that. Social links live in the site footer directly below this.
 */
export function PageFooter({ previous, next }: PageFooterProps) {
  if (!previous && !next) return null

  return (
    <div className='mt-12 flex gap-2 py-3'>
      {previous ? (
        <Link
          href={previous.url}
          className='flex flex-1 items-center gap-1.5 rounded-lg px-3 py-3 text-[var(--text-body)] text-sm transition-colors hover:bg-[var(--surface-active)]'
        >
          <ChevronLeft className='size-[14px] shrink-0 text-[var(--text-icon)]' />
          {previous.name}
        </Link>
      ) : (
        <div className='flex-1' />
      )}

      {next ? (
        <Link
          href={next.url}
          className='flex flex-1 items-center justify-end gap-1.5 rounded-lg px-3 py-3 text-[var(--text-body)] text-sm transition-colors hover:bg-[var(--surface-active)]'
        >
          {next.name}
          <ChevronRight className='size-[14px] shrink-0 text-[var(--text-icon)]' />
        </Link>
      ) : (
        <div className='flex-1' />
      )}
    </div>
  )
}
