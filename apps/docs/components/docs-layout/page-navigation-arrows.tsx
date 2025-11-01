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
          className='inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/40 bg-background px-2.5 py-1.5 text-muted-foreground/60 text-sm transition-all hover:border-border hover:bg-accent/50 hover:text-muted-foreground'
          aria-label='Previous page'
          title='Previous page'
        >
          <ChevronLeft className='h-4 w-4' />
        </Link>
      )}
      {next && (
        <Link
          href={next.url}
          className='inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/40 bg-background px-2.5 py-1.5 text-muted-foreground/60 text-sm transition-all hover:border-border hover:bg-accent/50 hover:text-muted-foreground'
          aria-label='Next page'
          title='Next page'
        >
          <ChevronRight className='h-4 w-4' />
        </Link>
      )}
    </div>
  )
}
