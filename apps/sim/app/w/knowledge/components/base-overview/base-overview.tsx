'use client'

import { LibraryBig } from 'lucide-react'
import Link from 'next/link'

interface BaseOverviewProps {
  id?: string
  title: string
  docCount: number
  tokenCount: string
  description: string
}

export function BaseOverview({ id, title, docCount, tokenCount, description }: BaseOverviewProps) {
  // Create URL with knowledge base name as query parameter
  const params = new URLSearchParams({
    kbName: title,
  })
  const href = `/w/knowledge/${id || title.toLowerCase().replace(/\s+/g, '-')}?${params.toString()}`

  return (
    <Link href={href} prefetch={true}>
      <div className='group flex cursor-pointer flex-col gap-3 rounded-md border bg-background p-4 transition-colors hover:bg-accent/50'>
        <div className='flex items-center gap-2'>
          <LibraryBig className='h-4 w-4 flex-shrink-0 text-muted-foreground' />
          <h3 className='truncate font-medium text-sm leading-tight'>{title}</h3>
        </div>

        <div className='flex flex-col gap-2'>
          <div className='flex items-center gap-2 text-muted-foreground text-xs'>
            <span>
              {docCount} {docCount === 1 ? 'doc' : 'docs'}
            </span>
            <span>•</span>
            <span>{tokenCount} tokens</span>
          </div>

          <p className='line-clamp-2 overflow-hidden text-muted-foreground text-xs'>
            {description}
          </p>
        </div>
      </div>
    </Link>
  )
}
