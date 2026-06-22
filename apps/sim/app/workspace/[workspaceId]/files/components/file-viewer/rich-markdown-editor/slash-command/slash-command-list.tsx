import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/core/utils/cn'
import type { SlashCommandItem } from './commands'

export interface SlashCommandListHandle {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

interface SlashCommandListProps {
  items: SlashCommandItem[]
  command: (item: SlashCommandItem) => void
}

const SURFACE_CLASS =
  'min-w-[220px] origin-top-left animate-in rounded-xl border border-[var(--border)] bg-[var(--bg)] p-1.5 shadow-sm duration-100 fade-in-0 zoom-in-95 slide-in-from-top-2 motion-reduce:animate-none'

const ITEM_CLASS =
  'relative flex w-full min-w-0 cursor-pointer select-none items-center gap-2 rounded-[5px] px-2 py-1.5 text-left font-medium text-[var(--text-body)] text-caption outline-none transition-colors [&>span]:min-w-0 [&>span]:truncate [&_svg]:pointer-events-none [&_svg]:size-[14px] [&_svg]:shrink-0 [&_svg]:text-[var(--text-icon)]'

/**
 * The `/` command popup. Mirrors the Chat composer's skills menu — same item chrome,
 * grouped headings, and arrow/enter keyboard navigation — so the two feel identical.
 * Exposes an imperative `onKeyDown` driven by the TipTap suggestion plugin.
 */
export const SlashCommandList = forwardRef<SlashCommandListHandle, SlashCommandListProps>(
  function SlashCommandList({ items, command }, ref) {
    const [activeIndex, setActiveIndex] = useState(0)
    const containerRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
      setActiveIndex(0)
    }, [items])

    useEffect(() => {
      containerRef.current
        ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    }, [activeIndex])

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }) => {
        if (items.length === 0) return false
        if (event.key === 'ArrowUp') {
          setActiveIndex((i) => (i + items.length - 1) % items.length)
          return true
        }
        if (event.key === 'ArrowDown') {
          setActiveIndex((i) => (i + 1) % items.length)
          return true
        }
        if (event.key === 'Enter') {
          const item = items[activeIndex]
          if (!item) return false
          command(item)
          return true
        }
        return false
      },
    }))

    const groups = useMemo(() => {
      const ordered: { group: string; items: { item: SlashCommandItem; index: number }[] }[] = []
      items.forEach((item, index) => {
        const bucket = ordered.find((g) => g.group === item.group)
        if (bucket) bucket.items.push({ item, index })
        else ordered.push({ group: item.group, items: [{ item, index }] })
      })
      return ordered
    }, [items])

    if (items.length === 0) {
      return (
        <div className={SURFACE_CLASS}>
          <p className='px-2 py-1.5 text-[var(--text-tertiary)] text-caption'>No results</p>
        </div>
      )
    }

    return (
      <div
        ref={containerRef}
        role='listbox'
        aria-label='Commands'
        className={cn(
          SURFACE_CLASS,
          'max-h-[330px] scroll-py-1.5 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        )}
      >
        {groups.map((group) => (
          <div key={group.group} role='group' aria-label={group.group}>
            <p
              aria-hidden='true'
              className='px-2 pt-1.5 pb-1 font-medium text-[var(--text-muted)] text-micro uppercase tracking-wide'
            >
              {group.group}
            </p>
            {group.items.map(({ item, index }) => {
              const Icon = item.icon
              return (
                <button
                  key={item.title}
                  type='button'
                  role='option'
                  id={`slash-command-${index}`}
                  aria-selected={index === activeIndex}
                  data-index={index}
                  className={cn(ITEM_CLASS, index === activeIndex && 'bg-[var(--surface-active)]')}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    command(item)
                  }}
                >
                  <Icon />
                  <span>{item.title}</span>
                  {item.shortcut && (
                    <span className='ml-auto shrink-0 pl-4 text-[var(--text-subtle)] text-micro'>
                      {item.shortcut}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    )
  }
)
