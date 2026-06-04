'use client'

import type * as React from 'react'
import { cn } from '@/lib/core/utils/cn'
import { handleKeyboardActivation } from '@/lib/core/utils/keyboard'

export interface CollapsibleCardProps {
  /** Header label (rendered in the standard truncated field-title style). */
  title: React.ReactNode
  /** Optional trailing header content, e.g. a type `Badge`. */
  badge?: React.ReactNode
  collapsed: boolean
  onToggleCollapse: () => void
  /** Body content, shown when expanded. */
  children: React.ReactNode
  className?: string
}

/**
 * A collapsible field card: a `--surface-4` header (click / keyboard to toggle)
 * with a truncated title + optional badge, over a `--surface-2` body. Shared by
 * the workflow input-mapping rows and the enrichment output-column config.
 */
export function CollapsibleCard({
  title,
  badge,
  collapsed,
  onToggleCollapse,
  children,
  className,
}: CollapsibleCardProps) {
  return (
    <div
      className={cn(
        'rounded-sm border border-[var(--border-1)]',
        collapsed ? 'overflow-hidden' : 'overflow-visible',
        className
      )}
    >
      <div
        role='button'
        tabIndex={0}
        className='flex cursor-pointer items-center justify-between rounded-t-[4px] bg-[var(--surface-4)] px-2.5 py-[5px]'
        onClick={onToggleCollapse}
        onKeyDown={(event) => handleKeyboardActivation(event, onToggleCollapse)}
      >
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <span className='block truncate font-medium text-[var(--text-tertiary)] text-sm'>
            {title}
          </span>
          {badge}
        </div>
      </div>
      {!collapsed && (
        <div className='flex flex-col gap-2 rounded-b-[4px] border-[var(--border-1)] border-t bg-[var(--surface-2)] px-2.5 pt-1.5 pb-2.5'>
          {children}
        </div>
      )}
    </div>
  )
}
