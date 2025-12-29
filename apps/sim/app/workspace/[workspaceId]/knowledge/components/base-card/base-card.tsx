'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Badge, DocumentAttachment, Tooltip } from '@/components/emcn'

interface BaseCardProps {
  id?: string
  title: string
  docCount: number
  description: string
  createdAt?: string
  updatedAt?: string
}

/**
 * Formats a date string to relative time (e.g., "2h ago", "3d ago")
 */
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

/**
 * Formats a date string to absolute format for tooltip display
 */
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

/**
 * Skeleton placeholder for a knowledge base card
 */
export function BaseCardSkeleton() {
  return (
    <div className='group flex h-full cursor-pointer flex-col gap-[12px] rounded-[4px] bg-[var(--surface-3)] px-[8px] py-[6px] transition-colors hover:bg-[var(--surface-4)] dark:bg-[var(--surface-4)] dark:hover:bg-[var(--surface-5)]'>
      <div className='flex items-center justify-between gap-[8px]'>
        <div className='h-[17px] w-[120px] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
        <div className='h-[22px] w-[90px] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
      </div>

      <div className='flex flex-1 flex-col gap-[8px]'>
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-[6px]'>
            <div className='h-[12px] w-[12px] animate-pulse rounded-[2px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
            <div className='h-[15px] w-[45px] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
          </div>
          <div className='h-[15px] w-[120px] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
        </div>

        <div className='h-0 w-full border-[var(--divider)] border-t' />

        <div className='flex h-[36px] flex-col gap-[6px]'>
          <div className='h-[15px] w-full animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
          <div className='h-[15px] w-[75%] animate-pulse rounded-[4px] bg-[var(--surface-4)] dark:bg-[var(--surface-5)]' />
        </div>
      </div>
    </div>
  )
}

/**
 * Renders multiple knowledge base card skeletons as a fragment
 */
export function BaseCardSkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <BaseCardSkeleton key={i} />
      ))}
    </>
  )
}

/**
 * Knowledge base card component displaying overview information
 */
export function BaseCard({ id, title, docCount, description, updatedAt }: BaseCardProps) {
  const params = useParams()
  const workspaceId = params?.workspaceId as string

  const searchParams = new URLSearchParams({
    kbName: title,
  })
  const href = `/workspace/${workspaceId}/knowledge/${id || title.toLowerCase().replace(/\s+/g, '-')}?${searchParams.toString()}`

  const shortId = id ? `kb-${id.slice(0, 8)}` : ''

  return (
    <Link href={href} prefetch={true} className='h-full'>
      <div className='group flex h-full cursor-pointer flex-col gap-[12px] rounded-[4px] bg-[var(--surface-3)] px-[8px] py-[6px] transition-colors hover:bg-[var(--surface-4)] dark:bg-[var(--surface-4)] dark:hover:bg-[var(--surface-5)]'>
        <div className='flex items-center justify-between gap-[8px]'>
          <h3 className='min-w-0 flex-1 truncate font-medium text-[14px] text-[var(--text-primary)]'>
            {title}
          </h3>
          {shortId && <Badge className='flex-shrink-0 rounded-[4px] text-[12px]'>{shortId}</Badge>}
        </div>

        <div className='flex flex-1 flex-col gap-[8px]'>
          <div className='flex items-center justify-between'>
            <span className='flex items-center gap-[6px] text-[12px] text-[var(--text-tertiary)]'>
              <DocumentAttachment className='h-[12px] w-[12px]' />
              {docCount} {docCount === 1 ? 'doc' : 'docs'}
            </span>
            {updatedAt && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <span className='text-[12px] text-[var(--text-tertiary)]'>
                    last updated: {formatRelativeTime(updatedAt)}
                  </span>
                </Tooltip.Trigger>
                <Tooltip.Content>{formatAbsoluteDate(updatedAt)}</Tooltip.Content>
              </Tooltip.Root>
            )}
          </div>

          <div className='h-0 w-full border-[var(--divider)] border-t' />

          <p className='line-clamp-2 h-[36px] text-[12px] text-[var(--text-tertiary)] leading-[18px]'>
            {description}
          </p>
        </div>
      </div>
    </Link>
  )
}
