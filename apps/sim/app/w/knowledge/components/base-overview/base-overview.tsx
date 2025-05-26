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

export function BaseOverview({
  id,
  title,
  docCount,
  tokenCount,
  description,
}: BaseOverviewProps) {
  return (
    <Link
      href={`/w/knowledge/${id || title.toLowerCase().replace(/\s+/g, '-')}`}
      prefetch={true}
    >
      <div className="group flex flex-col gap-3 rounded-md border bg-background p-4 transition-colors hover:bg-accent/50 cursor-pointer">
        <div className="flex items-center gap-2">
          <LibraryBig className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          <h3 className="font-medium text-sm leading-tight truncate">
            {title}
          </h3>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>
              {docCount} {docCount === 1 ? 'doc' : 'docs'}
            </span>
            <span>•</span>
            <span>{tokenCount} tokens</span>
          </div>

          <p className="text-xs text-muted-foreground line-clamp-2 overflow-hidden">
            {description}
          </p>
        </div>
      </div>
    </Link>
  )
}
