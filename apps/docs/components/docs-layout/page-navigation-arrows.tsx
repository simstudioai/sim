'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'

interface PageNavigationArrowsProps {
  previous?: {
    url: string
  }
  next?: {
    url: string
  }
}

const ARROW_LINK_CLASS =
  'flex size-[30px] items-center justify-center rounded-lg text-[var(--text-icon)] transition-colors hover:bg-[var(--surface-active)]'

export function PageNavigationArrows({ previous, next }: PageNavigationArrowsProps) {
  if (!previous && !next) return null

  return (
    <div className='flex items-center gap-2'>
      {previous && (
        <Link
          href={previous.url}
          className={ARROW_LINK_CLASS}
          aria-label='Previous page'
          title='Previous page'
        >
          <ChevronLeft className='size-[16px]' />
        </Link>
      )}
      {next && (
        <Link href={next.url} className={ARROW_LINK_CLASS} aria-label='Next page' title='Next page'>
          <ChevronRight className='size-[16px]' />
        </Link>
      )}
    </div>
  )
}
