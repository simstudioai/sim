'use client'

import { useState } from 'react'
import { Check, Copy, LibraryBig } from 'lucide-react'
import Link from 'next/link'

interface BaseOverviewProps {
  id?: string
  title: string
  docCount: number
  description: string
}

export function BaseOverview({ id, title, docCount, description }: BaseOverviewProps) {
  const [isCopied, setIsCopied] = useState(false)

  // Create URL with knowledge base name as query parameter
  const params = new URLSearchParams({
    kbName: title,
  })
  const href = `/w/knowledge/${id || title.toLowerCase().replace(/\s+/g, '-')}?${params.toString()}`

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (id) {
      try {
        await navigator.clipboard.writeText(id)
        setIsCopied(true)
        setTimeout(() => setIsCopied(false), 2000)
      } catch (err) {
        console.error('Failed to copy ID:', err)
      }
    }
  }

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
            <div className='flex items-center gap-2'>
              <span className='truncate font-mono'>{id?.slice(0, 8)}</span>
              <button
                onClick={handleCopy}
                className='flex h-4 w-4 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              >
                {isCopied ? <Check className='h-3 w-3' /> : <Copy className='h-3 w-3' />}
              </button>
            </div>
          </div>

          <p className='line-clamp-2 overflow-hidden text-muted-foreground text-xs'>
            {description}
          </p>
        </div>
      </div>
    </Link>
  )
}
