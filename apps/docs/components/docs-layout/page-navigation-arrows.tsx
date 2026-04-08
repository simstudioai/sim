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

export function PageNavigationArrows({ previous, next }: PageNavigationArrowsProps) {
  if (!previous && !next) return null

  return (
    <div className='flex items-center gap-2'>
      {previous && (
        <Link
          href={previous.url}
          className='inline-flex items-center justify-center rounded-[5px] border border-transparent px-2.5 py-2 text-foreground/40 transition-colors duration-200 hover:border-border/40 hover:bg-neutral-100 hover:text-foreground/70 dark:hover:bg-neutral-800'
          aria-label='Previous page'
          title='Previous page'
        >
          <ChevronLeft className='h-4 w-4' />
        </Link>
      )}
      {next && (
        <Link
          href={next.url}
          className='inline-flex items-center justify-center rounded-[5px] border border-transparent px-2.5 py-2 text-foreground/40 transition-colors duration-200 hover:border-border/40 hover:bg-neutral-100 hover:text-foreground/70 dark:hover:bg-neutral-800'
          aria-label='Next page'
          title='Next page'
        >
          <ChevronRight className='h-4 w-4' />
        </Link>
      )}
    </div>
  )
}
