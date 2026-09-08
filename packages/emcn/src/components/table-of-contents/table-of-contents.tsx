'use client'

import type { MouseEvent } from 'react'
import { cn } from '@sim/emcn'
import { List } from '@sim/emcn/icons'

export interface TableOfContentsItem {
  /** DOM id of the section's scroll target. */
  id: string
  label: string
}

export interface TableOfContentsProps {
  items: readonly TableOfContentsItem[]
  /** The section currently being read, supplied by the containing scroll view. */
  activeId?: string
  title?: string
  /** Layout and sizing of the navigation container. */
  className?: string
}

/**
 * Section navigation with smooth fragment scrolling and an active marker along its rail.
 * Targets can use `scroll-margin-top` to account for sticky headers. Reduced motion
 * preferences skip the animation, and modified clicks retain native link behavior.
 *
 * @example
 * <TableOfContents items={[{ id: 'pricing', label: 'Pricing' }]} activeId='pricing' />
 */
export function TableOfContents({
  items,
  activeId,
  title = 'On this page',
  className,
}: TableOfContentsProps) {
  function handleSectionClick(event: MouseEvent<HTMLAnchorElement>, id: string) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }

    const target = document.getElementById(id)
    if (!target) return

    event.preventDefault()
    const hash = event.currentTarget.hash
    if (window.location.hash !== hash) {
      window.history.pushState(window.history.state, '', hash)
    }
    target.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'start',
    })
  }

  return (
    <nav aria-label={title} className={cn('min-w-0', className)}>
      <p className='mb-4 flex items-center gap-2 text-[var(--text-body)] text-small'>
        <List aria-hidden='true' className='size-[14px] shrink-0 text-[var(--text-icon)]' />
        {title}
      </p>
      <ol className='border-[var(--border)] border-l'>
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${encodeURIComponent(item.id)}`}
              onClick={(event) => handleSectionClick(event, item.id)}
              aria-current={item.id === activeId ? 'location' : undefined}
              className={cn(
                'relative flex min-h-9 items-center py-2 pr-1 pl-4 text-small leading-5 transition-colors hover:text-[var(--text-body)] focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-[var(--text-icon)] focus-visible:outline-offset-2',
                item.id === activeId
                  ? 'before:-left-px text-[var(--text-body)] before:absolute before:inset-y-1.5 before:rounded-full before:border-[var(--text-body)] before:border-l-2'
                  : 'text-[var(--text-muted)]'
              )}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  )
}
