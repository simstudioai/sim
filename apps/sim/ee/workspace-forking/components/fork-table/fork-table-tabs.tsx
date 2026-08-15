'use client'

import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useRef } from 'react'
import { cn } from '@sim/emcn'
import { FORK_TABLE_FOCUS_RING_CLASS } from '@/ee/workspace-forking/components/fork-table/fork-table-chrome'

/** One tab in a {@link ForkTableTabs} strip. */
export interface ForkTableTab<Id extends string> {
  id: Id
  label: ReactNode
}

interface ForkTableTabsProps<Id extends string> {
  items: ReadonlyArray<ForkTableTab<Id>>
  activeId: Id
  onChange: (id: Id) => void
  /** Accessible name for the strip. */
  label: string
}

/** Index an arrow/Home/End key moves to, or `null` when the key does not drive the strip. */
function nextTabIndex(key: string, current: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count
    case 'ArrowLeft':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}

/**
 * The console's tab strip, drawn exactly like the shared table's.
 *
 * `role='tablist'` promises two things — the strip is ONE tab stop, and the arrow keys move within
 * it — and both are honoured: a roving `tabIndex` plus Left/Right/Home/End, selecting as focus
 * lands. That automatic-activation pattern is the ARIA recommendation when switching is cheap, and
 * every tab here swaps an already-loaded view.
 */
export function ForkTableTabs<Id extends string>({
  items,
  activeId,
  onChange,
  label,
}: ForkTableTabsProps<Id>) {
  const listRef = useRef<HTMLDivElement>(null)
  const activeIndex = items.findIndex((tab) => tab.id === activeId)

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = nextTabIndex(event.key, activeIndex, items.length)
    if (target === null) return
    event.preventDefault()
    onChange(items[target].id)
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus()
  }

  return (
    <div
      ref={listRef}
      role='tablist'
      aria-label={label}
      onKeyDown={handleKeyDown}
      className='flex items-center gap-4 border-[var(--border)] border-b'
    >
      {items.map((tab, index) => {
        const isActive = index === activeIndex
        return (
          <button
            key={tab.id}
            type='button'
            role='tab'
            aria-selected={isActive}
            // With no tab active the first one holds the strip's single tab stop, so the
            // keyboard can always reach it.
            tabIndex={(activeIndex === -1 ? index === 0 : isActive) ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              '-mb-px cursor-pointer border-b-2 pb-2 text-small transition-colors',
              FORK_TABLE_FOCUS_RING_CLASS,
              isActive
                ? 'border-[var(--text-body)] text-[var(--text-body)]'
                : 'border-transparent text-[var(--text-muted)] hover-hover:text-[var(--text-body)]'
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
