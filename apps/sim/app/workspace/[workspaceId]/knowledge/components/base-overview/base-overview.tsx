'use client'

import { useState } from 'react'
import { Check, Copy, LibraryBig } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('BaseOverviewComponent')

interface BaseOverviewProps {
  id?: string
  title: string
  docCount: number
  description: string
  createdAt?: string
  updatedAt?: string
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) {
    return 'just now'
  }
  if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60)
    return `${minutes}m ago`
  }
  if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600)
    return `${hours}h ago`
  }
  if (diffInSeconds < 604800) {
    const days = Math.floor(diffInSeconds / 86400)
    return `${days}d ago`
  }
  if (diffInSeconds < 2592000) {
    const weeks = Math.floor(diffInSeconds / 604800)
    return `${weeks}w ago`
  }
  if (diffInSeconds < 31536000) {
    const months = Math.floor(diffInSeconds / 2592000)
    return `${months}mo ago`
  }
  const years = Math.floor(diffInSeconds / 31536000)
  return `${years}y ago`
}

function formatAbsoluteDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function BaseOverview({
  id,
  title,
  docCount,
  description,
  createdAt,
  updatedAt,
}: BaseOverviewProps) {
  const [isCopied, setIsCopied] = useState(false)
  const params = useParams()
  const workspaceId = params?.workspaceId as string

  const searchParams = new URLSearchParams({
    kbName: title,
  })
  const href = `/workspace/${workspaceId}/knowledge/${id || title.toLowerCase().replace(/\s+/g, '-')}?${searchParams.toString()}`

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    if (id) {
      try {
        await navigator.clipboard.writeText(id)
        setIsCopied(true)
        setTimeout(() => setIsCopied(false), 2000)
      } catch (err) {
        logger.error('Failed to copy ID:', err)
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

          {/* Timestamps */}
          {(createdAt || updatedAt) && (
            <div className='flex items-center gap-2 text-muted-foreground text-xs'>
              {updatedAt && (
                <span title={`Last updated: ${formatAbsoluteDate(updatedAt)}`}>
                  Updated {formatRelativeTime(updatedAt)}
                </span>
              )}
              {updatedAt && createdAt && <span>•</span>}
              {createdAt && (
                <span title={`Created: ${formatAbsoluteDate(createdAt)}`}>
                  Created {formatRelativeTime(createdAt)}
                </span>
              )}
            </div>
          )}

          <p className='line-clamp-2 overflow-hidden text-muted-foreground text-xs'>
            {description}
          </p>
        </div>
      </div>
    </Link>
  )
}
