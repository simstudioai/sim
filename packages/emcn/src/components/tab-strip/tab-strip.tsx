'use client'

import {
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { Plus, X } from '../../icons'
import { cn } from '../../lib/cn'
import { Button } from '../button/button'
import { Tooltip } from '../tooltip/tooltip'

/** One tab in a {@link TabStrip}. */
export interface TabStripItem {
  id: string
  title: string
  /**
   * Leading glyph. The caller owns what this is — a favicon, a spinner, a
   * status icon — because only it knows what the tab represents.
   */
  icon?: ReactNode
  active?: boolean
  /**
   * Pinned tabs render icon-only and cannot be closed. Ordering them first is
   * the caller's job, since only it knows the underlying list.
   */
  pinned?: boolean
  /**
   * Fuller detail for the hover tooltip — a path the label abbreviates, the
   * command a tab is running. Shown whenever present, not only when the label
   * is clipped: it says something the tab cannot, so there is always a reason
   * to hover. Without it the tooltip falls back to the title, and only appears
   * when the title is actually cut off.
   */
  tooltip?: string
}

export interface TabStripProps {
  tabs: TabStripItem[]
  onSelect: (id: string) => void
  /** Omit to make tabs uncloseable. Never offered for a pinned tab. */
  onClose?: (id: string) => void
  /** Omit to hide the new-tab button. */
  onNew?: () => void
  /** Enables drag reordering. Receives the tab's final index. */
  onReorder?: (id: string, targetIndex: number) => void
  onTabContextMenu?: (event: ReactMouseEvent<HTMLDivElement>, id: string) => void
  /**
   * Called as a tab starts being dragged, to add whatever that tab means
   * outside the strip to the drag. Supplying it also makes tabs draggable in a
   * strip that cannot be reordered.
   */
  onTabDragStart?: (event: ReactDragEvent<HTMLDivElement>, id: string) => void
  /** Disables the new-tab button, with a tooltip explaining why. */
  maxTabs?: number
  newTabLabel?: string
  /** Rendered after the new-tab button, for menus and overlays. */
  children?: ReactNode
}

/**
 * Whether a title is clipped enough to be worth a tooltip. A couple of hidden
 * pixels is not, and a tooltip on every tab is noise.
 */
export function isTabTitleTruncated(
  element: Pick<HTMLElement, 'clientWidth' | 'scrollWidth'>
): boolean {
  const hiddenWidth = element.scrollWidth - element.clientWidth
  const tooltipThreshold = Math.max(32, element.clientWidth * 0.25)
  return hiddenWidth >= tooltipThreshold
}

/**
 * Resolves a drop gap to a final index, or null when the move is a no-op.
 *
 * Pinned tabs occupy a leading partition: a pinned tab cannot be dragged past
 * the boundary and an unpinned one cannot be dragged before it, so dropping
 * across it clamps rather than reorders.
 */
export function tabDropIndex(
  tabs: TabStripItem[],
  draggedId: string,
  gapIndex: number
): number | null {
  const fromIndex = tabs.findIndex((tab) => tab.id === draggedId)
  if (fromIndex < 0 || !Number.isFinite(gapIndex)) return null

  const pinnedCount = tabs.filter((tab) => tab.pinned).length
  const dragged = tabs[fromIndex]
  const minGapIndex = dragged.pinned ? 0 : pinnedCount
  const maxGapIndex = dragged.pinned ? pinnedCount : tabs.length
  const boundedGapIndex = Math.max(minGapIndex, Math.min(maxGapIndex, Math.trunc(gapIndex)))
  const targetIndex = boundedGapIndex > fromIndex ? boundedGapIndex - 1 : boundedGapIndex
  return targetIndex === fromIndex ? null : targetIndex
}

interface TabProps {
  tab: TabStripItem
  index: number
  onSelect: (id: string) => void
  onClose?: (id: string) => void
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>, id: string) => void
  draggable: boolean
  dragging: boolean
  showDropBefore: boolean
  showDropAfter: boolean
  onDragStart: (event: ReactDragEvent<HTMLDivElement>, id: string) => void
  onDragOver: (event: ReactDragEvent<HTMLDivElement>, index: number) => void
  onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
}

function Tab({
  tab,
  index,
  onSelect,
  onClose,
  onContextMenu,
  draggable,
  dragging,
  showDropBefore,
  showDropAfter,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDragEnd,
}: TabProps) {
  const titleRef = useRef<HTMLSpanElement>(null)
  const [titleTruncated, setTitleTruncated] = useState(false)
  const closeable = Boolean(onClose) && !tab.pinned

  useLayoutEffect(() => {
    const element = titleRef.current
    if (!element) return
    const update = () => setTitleTruncated(isTabTitleTruncated(element))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [tab.title])

  return (
    <div
      className={cn(
        'group relative select-none',
        tab.pinned
          ? 'w-[34px] min-w-[34px] max-w-[34px] flex-none'
          : 'min-w-[96px] max-w-[180px] flex-1 basis-[140px]',
        dragging && 'opacity-30'
      )}
      draggable={draggable}
      onDragStart={(event) => onDragStart(event, tab.id)}
      onDragOver={(event) => onDragOver(event, index)}
      onDragLeave={onDragLeave}
      onDragEnd={onDragEnd}
      onContextMenu={(event) => onContextMenu?.(event, tab.id)}
    >
      {showDropBefore && (
        <div className='-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-0 z-30 h-[16px] w-[2px] rounded-full bg-[var(--text-subtle)]' />
      )}
      {showDropAfter && (
        <div className='-translate-y-1/2 pointer-events-none absolute top-1/2 right-0 z-30 h-[16px] w-[2px] translate-x-1/2 rounded-full bg-[var(--text-subtle)]' />
      )}
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            type='button'
            variant='subtle'
            size='sm'
            aria-current={tab.active ? 'page' : undefined}
            aria-label={tab.pinned ? tab.title : undefined}
            className={cn(
              '-mb-px h-[30px] w-full select-none rounded-b-none border border-transparent border-b-0 bg-transparent py-0 font-normal text-caption',
              tab.pinned ? 'justify-center px-0' : 'justify-start gap-1.5 px-2',
              closeable && !tab.pinned && 'pr-7',
              tab.active &&
                'hover-hover:!border-[var(--border)] hover-hover:!bg-[var(--bg)] hover-hover:!text-[var(--text-primary)] hover-hover:!brightness-100 hover-hover:!opacity-100 relative z-10 border-[var(--border)] bg-[var(--bg)] text-[var(--text-primary)] transition-none'
            )}
            onClick={() => onSelect(tab.id)}
          >
            {tab.icon}
            {!tab.pinned && (
              <span ref={titleRef} className='min-w-0 flex-1 select-none truncate text-left'>
                {tab.title}
              </span>
            )}
          </Button>
        </Tooltip.Trigger>
        {(tab.tooltip || tab.pinned || titleTruncated) && (
          <Tooltip.Content side='bottom'>{tab.tooltip || tab.title}</Tooltip.Content>
        )}
      </Tooltip.Root>
      {closeable && (
        <Button
          type='button'
          variant='ghost-secondary'
          size='sm'
          aria-label={`Close ${tab.title}`}
          className={cn(
            'absolute top-[5px] right-1 z-20 size-[20px] p-0 transition-opacity',
            tab.active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
          onClick={(event) => {
            event.stopPropagation()
            onClose?.(tab.id)
          }}
        >
          <X className='size-[11px]' />
        </Button>
      )}
    </div>
  )
}

/**
 * Chrome-style tab strip, shared by every panel that hosts multiple live
 * surfaces (the agent browser's pages, the agent terminal's shells).
 *
 * The strip owns interaction — selection, closing, drag reordering, the
 * new-tab affordance, tooltips on clipped titles — and nothing about what a tab
 * contains. Callers map their own state onto {@link TabStripItem} and supply
 * the icon, which is why a favicon and a spinning shell indicator can share
 * one component.
 */
export function TabStrip({
  tabs,
  onSelect,
  onClose,
  onNew,
  onReorder,
  onTabContextMenu,
  onTabDragStart,
  maxTabs,
  newTabLabel = 'New tab',
  children,
}: TabStripProps) {
  const atLimit = maxTabs !== undefined && tabs.length >= maxTabs
  const draggedIdRef = useRef<string | null>(null)
  const dropTargetIndexRef = useRef<number | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null)
  const reorderable = Boolean(onReorder)

  const resetDrag = useCallback(() => {
    draggedIdRef.current = null
    dropTargetIndexRef.current = null
    setDraggedId(null)
    setDropTargetIndex(null)
  }, [])

  const handleDragStart = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, id: string) => {
      if (!reorderable && !onTabDragStart) {
        event.preventDefault()
        return
      }
      if (reorderable) {
        draggedIdRef.current = id
        setDraggedId(id)
        // `move` while the tab can also be dropped elsewhere would forbid the
        // copy that dropping outside the strip is; the owner widens it below.
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', id)
      }
      // The strip knows about ordering and nothing else. Anything a tab means
      // outside it — the page it holds, the shell it runs — belongs to whoever
      // owns the tabs, so they attach it.
      onTabDragStart?.(event, id)
    },
    [reorderable, onTabDragStart]
  )

  const handleDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, index: number) => {
      const id = draggedIdRef.current
      if (!reorderable || !id) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      const rect = event.currentTarget.getBoundingClientRect()
      const gapIndex = event.clientX < rect.left + rect.width / 2 ? index : index + 1
      const targetIndex = tabDropIndex(tabs, id, gapIndex)
      dropTargetIndexRef.current = targetIndex
      setDropTargetIndex(targetIndex)
    },
    [reorderable, tabs]
  )

  const handleDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault()
      const id = draggedIdRef.current
      const targetIndex = dropTargetIndexRef.current
      if (id && targetIndex !== null) onReorder?.(id, targetIndex)
      resetDrag()
    },
    [onReorder, resetDrag]
  )

  const draggedIndex = tabs.findIndex((tab) => tab.id === draggedId)

  return (
    <div className='flex h-[34px] shrink-0 select-none items-end gap-1 border-[var(--border)] border-b bg-transparent px-2 pt-1'>
      {/*
        The row is sized by its tabs rather than filling the strip, so the new-tab
        button that follows sits beside the last tab instead of against the far
        edge. Once the tabs no longer fit, the row shrinks (min-w-0 permits it)
        and scrolls horizontally instead of growing, which pins the button back
        at the right edge rather than pushing it out of view.
      */}
      <div
        className='flex min-w-0 shrink select-none items-end gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        onDragOver={(event) => {
          if (draggedIdRef.current) event.preventDefault()
        }}
        onDrop={handleDrop}
      >
        {tabs.map((tab, index) => (
          <Tab
            key={tab.id}
            tab={tab}
            index={index}
            draggable={reorderable || Boolean(onTabDragStart)}
            dragging={draggedId === tab.id}
            showDropBefore={dropTargetIndex === index && draggedIndex >= 0 && draggedIndex > index}
            showDropAfter={dropTargetIndex === index && draggedIndex >= 0 && draggedIndex < index}
            onSelect={onSelect}
            {...(onClose ? { onClose } : {})}
            {...(onTabContextMenu ? { onContextMenu: onTabContextMenu } : {})}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragLeave={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                event.currentTarget.contains(event.relatedTarget)
              ) {
                return
              }
              dropTargetIndexRef.current = null
              setDropTargetIndex(null)
            }}
            onDragEnd={resetDrag}
          />
        ))}
      </div>
      {onNew && (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              type='button'
              variant='ghost-secondary'
              size='sm'
              aria-label={newTabLabel}
              className='mb-px size-[28px] shrink-0 p-0'
              disabled={atLimit}
              onClick={onNew}
            >
              <Plus className='size-[14px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content side='bottom'>
            {atLimit ? `Maximum of ${maxTabs} tabs` : newTabLabel}
          </Tooltip.Content>
        </Tooltip.Root>
      )}
      {children}
    </div>
  )
}
