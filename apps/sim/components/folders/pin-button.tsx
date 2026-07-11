'use client'

import type { MouseEvent } from 'react'
import { cn } from '@sim/emcn'
import { Pin } from '@sim/emcn/icons'
import type { PinnedResourceType } from '@/lib/api/contracts'
import { usePinItem, useUnpinItem } from '@/hooks/queries/pinned-items'

interface PinButtonProps {
  workspaceId: string
  resourceType: PinnedResourceType
  resourceId: string
  pinned: boolean
  className?: string
}

/**
 * Row-level pin toggle. Resource-type-parameterized so it works identically
 * for folders, workflows, files, knowledge bases, and tables — callers pass
 * whether the row is currently pinned (looked up once via `usePinnedIds`)
 * rather than each row independently querying the pinned-items list.
 */
export function PinButton({
  workspaceId,
  resourceType,
  resourceId,
  pinned,
  className,
}: PinButtonProps) {
  const pinItem = usePinItem()
  const unpinItem = useUnpinItem()

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    if (pinned) {
      unpinItem.mutate({ workspaceId, resourceType, resourceId })
    } else {
      pinItem.mutate({ workspaceId, resourceType, resourceId })
    }
  }

  return (
    <button
      type='button'
      aria-label={pinned ? 'Unpin' : 'Pin'}
      aria-pressed={pinned}
      onClick={handleClick}
      disabled={pinItem.isPending || unpinItem.isPending}
      className={cn(
        'flex size-[20px] flex-shrink-0 items-center justify-center rounded-sm transition-colors',
        pinned
          ? 'text-[var(--text-body)] opacity-100 hover-hover:opacity-80'
          : 'text-[var(--text-icon)] opacity-0 hover-hover:opacity-100 group-hover:opacity-100',
        className
      )}
    >
      <Pin className={cn('size-[14px]', pinned && 'fill-current')} aria-hidden='true' />
    </button>
  )
}
