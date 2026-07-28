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
  /**
   * Whether this row is currently pinned. Passed in rather than read per-row so a
   * list resolves pin state once via `usePinnedIds` instead of once per row.
   */
  pinned: boolean
  /** Layout/positioning only — the button owns its own chrome. */
  className?: string
}

/**
 * Row-level pin toggle, parameterized by resource type so workflows, files,
 * knowledge bases, and tables all share one implementation.
 *
 * An unpinned button is revealed on row hover and a pinned one stays visible, so the
 * containing row must set `group`. Keyboard users get it via `focus-visible`, which
 * hover-reveal alone would strand.
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

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    // Rows are usually links or have their own onClick — pinning must not navigate.
    event.preventDefault()
    event.stopPropagation()
    const mutation = pinned ? unpinItem : pinItem
    mutation.mutate({ workspaceId, resourceType, resourceId })
  }

  return (
    <button
      type='button'
      aria-label={pinned ? 'Unpin' : 'Pin'}
      aria-pressed={pinned}
      onClick={handleClick}
      disabled={pinItem.isPending || unpinItem.isPending}
      className={cn(
        'flex size-[20px] flex-shrink-0 items-center justify-center rounded-[4px] transition-opacity',
        'focus-visible:opacity-100',
        pinned
          ? 'text-[var(--text-body)] opacity-100'
          : 'text-[var(--text-icon)] opacity-0 group-hover:opacity-100',
        className
      )}
    >
      <Pin className={cn('size-[14px]', pinned && 'fill-current')} />
    </button>
  )
}
