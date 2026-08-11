'use client'

import {
  forwardRef,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Plus, X } from '../../icons'
import { cn } from '../../lib/cn'
import { Button } from '../button/button'
import { Tooltip } from '../tooltip/tooltip'

const DRAG_EDGE_ZONE = 40
const DRAG_SCROLL_SPEED = 8
const TITLE_TOOLTIP_HIDDEN_PX = 8
const TAB_TRANSITION = { duration: 0.1, ease: [0.2, 0, 0, 1] as const }

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
  /** Shows that background work is happening in a tab the user is not viewing. */
  attention?: boolean
}

/** How a tab selection was initiated. */
export type TabStripSelectionSource = 'pointer' | 'keyboard'

export interface TabStripProps {
  tabs: TabStripItem[]
  onSelect: (id: string, source?: TabStripSelectionSource) => void
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
 * pixels is not, but a tab should not lose a meaningful part of its identity
 * before it explains itself.
 */
export function isTabTitleTruncated(
  element: Pick<HTMLElement, 'clientWidth' | 'scrollWidth'>
): boolean {
  const hiddenWidth = element.scrollWidth - element.clientWidth
  return hiddenWidth >= TITLE_TOOLTIP_HIDDEN_PX
}

/** Final horizontal position for a wheel gesture, or null when it cannot move the strip. */
export function tabStripWheelPosition(
  scrollLeft: number,
  scrollWidth: number,
  clientWidth: number,
  deltaX: number,
  deltaY: number
): number | null {
  const maxScrollLeft = Math.max(0, scrollWidth - clientWidth)
  if (maxScrollLeft === 0) return null
  const delta = Math.abs(deltaX) >= Math.abs(deltaY) ? deltaX : deltaY
  if (delta === 0) return null
  const next = Math.max(0, Math.min(maxScrollLeft, scrollLeft + delta))
  return next === scrollLeft ? null : next
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
  onSelect: (id: string, source?: TabStripSelectionSource) => void
  onClose?: (id: string) => void
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>, id: string) => void
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>, id: string) => void
  draggable: boolean
  dragging: boolean
  focusable: boolean
  showDropBefore: boolean
  showDropAfter: boolean
  reduceMotion: boolean
  onDragStart: (event: ReactDragEvent<HTMLDivElement>, id: string) => void
  onDragEnd: () => void
}

const Tab = forwardRef<HTMLDivElement, TabProps>(function Tab(
  {
    tab,
    onSelect,
    onClose,
    onContextMenu,
    onKeyDown,
    draggable,
    dragging,
    focusable,
    showDropBefore,
    showDropAfter,
    reduceMotion,
    onDragStart,
    onDragEnd,
  },
  ref
) {
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
    <motion.div
      ref={ref}
      initial={reduceMotion ? false : { opacity: 0, scale: 0.98 }}
      animate={reduceMotion ? undefined : { opacity: 1, scale: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98 }}
      transition={TAB_TRANSITION}
      className={cn(
        'group relative select-none',
        // Width, not flex-basis: `flex-1` compiles to `flex: 1 1 0%`, and
        // Tailwind emits the `flex` shorthand after `flex-basis`, so pairing
        // the two silently discarded the basis and left every tab sized by its
        // own title. `shrink` still lets a crowded strip squeeze them to the
        // floor before it starts scrolling.
        tab.pinned
          ? 'w-[34px] min-w-[34px] max-w-[34px] flex-none'
          : 'w-[156px] min-w-[96px] shrink',
        dragging && 'opacity-30'
      )}
      data-tab-strip-item={tab.id}
      draggable={draggable}
      onDragStartCapture={(event) => onDragStart(event, tab.id)}
      onDragEndCapture={onDragEnd}
      onContextMenu={(event) => onContextMenu?.(event, tab.id)}
      onAuxClick={(event) => {
        if (event.button !== 1 || !closeable) return
        event.preventDefault()
        onClose?.(tab.id)
      }}
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
            role='tab'
            aria-selected={Boolean(tab.active)}
            aria-label={tab.pinned ? tab.title : undefined}
            data-tab-strip-button={tab.id}
            tabIndex={focusable ? 0 : -1}
            className={cn(
              'h-[30px] w-full select-none rounded-b-none border border-transparent border-b-0 bg-transparent py-0 text-caption',
              tab.pinned ? 'justify-center px-0' : 'justify-start gap-1.5 px-2',
              closeable && !tab.pinned && 'pr-8',
              tab.active &&
                'hover-hover:!border-[var(--border)] hover-hover:!bg-[var(--bg)] hover-hover:!text-[var(--text-primary)] hover-hover:!brightness-100 hover-hover:!opacity-100 relative z-10 border-[var(--border)] bg-[var(--bg)] text-[var(--text-primary)] transition-none'
            )}
            onClick={() => onSelect(tab.id, 'pointer')}
            onKeyDown={(event) => onKeyDown(event, tab.id)}
          >
            {tab.icon}
            {!tab.pinned && (
              <span ref={titleRef} className='min-w-0 flex-1 select-none truncate text-left'>
                {tab.title}
              </span>
            )}
            {tab.attention && !tab.active && (
              <span
                className={cn(
                  'size-1.5 shrink-0 rounded-full bg-[var(--brand-primary)]',
                  tab.pinned && 'absolute right-1 bottom-1'
                )}
                aria-label='Background activity'
              />
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
          tabIndex={-1}
          className={cn(
            'absolute top-[3px] right-0.5 z-20 size-[24px] p-0 transition-opacity',
            tab.active
              ? 'opacity-100'
              : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
          )}
          onClick={(event) => {
            event.stopPropagation()
            onClose?.(tab.id)
          }}
        >
          <X className='size-[11px]' />
        </Button>
      )}
    </motion.div>
  )
})

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
  const stripRef = useRef<HTMLDivElement>(null)
  const scrollNodeRef = useRef<HTMLDivElement>(null)
  const draggedIdRef = useRef<string | null>(null)
  const dropTargetIndexRef = useRef<number | null>(null)
  const autoScrollRafRef = useRef<number | null>(null)
  const autoScrollDirectionRef = useRef(0)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const reduceMotion = useReducedMotion() ?? false
  const reorderable = Boolean(onReorder)
  const pinnedTabs = useMemo(() => tabs.filter((tab) => tab.pinned), [tabs])
  const regularTabs = useMemo(() => tabs.filter((tab) => !tab.pinned), [tabs])
  const activeRegularId = regularTabs.find((tab) => tab.active)?.id ?? null
  const regularTabOrder = regularTabs.map((tab) => tab.id).join('\u0000')
  const activeIndex = tabs.findIndex((tab) => tab.active)

  const updateOverflow = useCallback(() => {
    const node = scrollNodeRef.current
    if (!node) {
      setCanScrollLeft(false)
      setCanScrollRight(false)
      return
    }
    const maxScrollLeft = Math.max(0, node.scrollWidth - node.clientWidth)
    setCanScrollLeft(node.scrollLeft > 1)
    setCanScrollRight(node.scrollLeft < maxScrollLeft - 1)
  }, [])

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRafRef.current !== null) cancelAnimationFrame(autoScrollRafRef.current)
    autoScrollRafRef.current = null
    autoScrollDirectionRef.current = 0
  }, [])

  const resetDrag = useCallback(() => {
    stopAutoScroll()
    draggedIdRef.current = null
    dropTargetIndexRef.current = null
    setDraggedId(null)
    setDropTargetIndex(null)
  }, [stopAutoScroll])

  useEffect(() => resetDrag, [resetDrag])

  const revealActiveTab = useCallback(() => {
    const node = scrollNodeRef.current
    if (!node || !activeRegularId) return
    const element = Array.from(node.querySelectorAll<HTMLElement>('[data-tab-strip-item]')).find(
      (candidate) => candidate.dataset.tabStripItem === activeRegularId
    )
    if (!element) return
    const tabRect = element.getBoundingClientRect()
    const nodeRect = node.getBoundingClientRect()
    const tabLeft = tabRect.left - nodeRect.left + node.scrollLeft
    const tabRight = tabLeft + tabRect.width
    const nextLeft =
      tabLeft < node.scrollLeft
        ? tabLeft
        : tabRight > node.scrollLeft + node.clientWidth
          ? tabRight - node.clientWidth
          : null
    if (nextLeft === null) return
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    node.scrollTo({ left: nextLeft, behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [activeRegularId, regularTabOrder])

  useLayoutEffect(() => {
    revealActiveTab()
  }, [revealActiveTab])

  useLayoutEffect(() => {
    const node = scrollNodeRef.current
    if (!node) return
    const updateLayout = () => {
      updateOverflow()
      revealActiveTab()
    }
    updateLayout()
    node.addEventListener('scroll', updateOverflow, { passive: true })
    if (typeof ResizeObserver === 'undefined') {
      return () => node.removeEventListener('scroll', updateOverflow)
    }
    const observer = new ResizeObserver(updateLayout)
    observer.observe(node)
    return () => {
      observer.disconnect()
      node.removeEventListener('scroll', updateOverflow)
    }
  }, [regularTabs.length, revealActiveTab, updateOverflow])

  useEffect(() => {
    const strip = stripRef.current
    if (!strip) return
    const handleWheel = (event: WheelEvent) => {
      const node = scrollNodeRef.current
      if (!node) return
      const next = tabStripWheelPosition(
        node.scrollLeft,
        node.scrollWidth,
        node.clientWidth,
        event.deltaX,
        event.deltaY
      )
      if (next === null) return
      node.scrollLeft = next
      updateOverflow()
      event.preventDefault()
    }
    strip.addEventListener('wheel', handleWheel, { passive: false })
    return () => strip.removeEventListener('wheel', handleWheel)
  }, [updateOverflow])

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

  const startEdgeScroll = useCallback(
    (clientX: number) => {
      const node = scrollNodeRef.current
      if (!node) return
      const dragged = tabs.find((tab) => tab.id === draggedIdRef.current)
      if (dragged?.pinned) {
        stopAutoScroll()
        return
      }
      const rect = node.getBoundingClientRect()
      const direction =
        clientX < rect.left + DRAG_EDGE_ZONE ? -1 : clientX > rect.right - DRAG_EDGE_ZONE ? 1 : 0
      if (direction !== 0 && autoScrollDirectionRef.current === direction) return
      stopAutoScroll()
      if (direction === 0) return
      autoScrollDirectionRef.current = direction
      const tick = () => {
        const before = node.scrollLeft
        node.scrollLeft += direction * DRAG_SCROLL_SPEED
        updateOverflow()
        if (node.scrollLeft === before) {
          autoScrollRafRef.current = null
          autoScrollDirectionRef.current = 0
          return
        }
        autoScrollRafRef.current = requestAnimationFrame(tick)
      }
      autoScrollRafRef.current = requestAnimationFrame(tick)
    },
    [stopAutoScroll, tabs, updateOverflow]
  )

  const handleDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      const id = draggedIdRef.current
      if (!reorderable || !id) return
      event.preventDefault()
      const strip = stripRef.current
      if (!strip) return
      const elements = Array.from(strip.querySelectorAll<HTMLElement>('[data-tab-strip-item]'))
      const gapIndex = elements.findIndex((element) => {
        const rect = element.getBoundingClientRect()
        return event.clientX < rect.left + rect.width / 2
      })
      const resolvedGapIndex = gapIndex < 0 ? elements.length : gapIndex
      const targetIndex = tabDropIndex(tabs, id, resolvedGapIndex)
      event.dataTransfer.dropEffect = targetIndex === null ? 'none' : 'move'
      dropTargetIndexRef.current = targetIndex
      setDropTargetIndex(targetIndex)
      startEdgeScroll(event.clientX)
    },
    [reorderable, startEdgeScroll, tabs]
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

  const focusTab = useCallback((id: string) => {
    const strip = stripRef.current
    const button = strip
      ? Array.from(strip.querySelectorAll<HTMLButtonElement>('[data-tab-strip-button]')).find(
          (candidate) => candidate.dataset.tabStripButton === id
        )
      : null
    button?.focus()
  }, [])

  const handleTabKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
      const index = tabs.findIndex((tab) => tab.id === id)
      if (index < 0) return
      let target: TabStripItem | undefined
      switch (event.key) {
        case 'ArrowLeft':
          target = tabs[(index - 1 + tabs.length) % tabs.length]
          break
        case 'ArrowRight':
          target = tabs[(index + 1) % tabs.length]
          break
        case 'Home':
          target = tabs[0]
          break
        case 'End':
          target = tabs[tabs.length - 1]
          break
        case 'Delete':
          if (onClose && !tabs[index].pinned) {
            event.preventDefault()
            onClose(id)
          }
          return
        default:
          return
      }
      if (!target) return
      event.preventDefault()
      onSelect(target.id, 'keyboard')
      focusTab(target.id)
    },
    [focusTab, onClose, onSelect, tabs]
  )

  const renderTab = (tab: TabStripItem) => {
    const index = tabs.findIndex((candidate) => candidate.id === tab.id)
    return (
      <Tab
        key={tab.id}
        tab={tab}
        draggable={reorderable || Boolean(onTabDragStart)}
        dragging={draggedId === tab.id}
        focusable={tab.active || (activeIndex < 0 && index === 0)}
        showDropBefore={dropTargetIndex === index && draggedIndex >= 0 && draggedIndex > index}
        showDropAfter={dropTargetIndex === index && draggedIndex >= 0 && draggedIndex < index}
        reduceMotion={reduceMotion}
        onSelect={onSelect}
        {...(onClose ? { onClose } : {})}
        {...(onTabContextMenu ? { onContextMenu: onTabContextMenu } : {})}
        onKeyDown={handleTabKeyDown}
        onDragStart={handleDragStart}
        onDragEnd={resetDrag}
      />
    )
  }

  return (
    <div
      ref={stripRef}
      className='flex h-[34px] shrink-0 select-none items-end gap-1 border-[var(--border)] border-b bg-transparent px-2 pt-1'
      onDragOver={handleDragOver}
      onDragLeave={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          event.currentTarget.contains(event.relatedTarget)
        ) {
          return
        }
        stopAutoScroll()
        dropTargetIndexRef.current = null
        setDropTargetIndex(null)
      }}
      onDrop={handleDrop}
    >
      {/*
        The row is sized by its tabs rather than filling the strip, so the new-tab
        button that follows sits beside the last tab instead of against the far
        edge. Once the tabs no longer fit, the row shrinks (min-w-0 permits it)
        and scrolls horizontally instead of growing, which pins the button back
        at the right edge rather than pushing it out of view.
      */}
      {/*
        `-mb-px` sits on this row rather than on the tabs inside it. The active tab has to
        extend one pixel past the strip to cover its bottom border, and while that pixel
        came from the tab it overflowed THIS element — which is a scroll container, since
        `overflow-x: auto` computes the visible `overflow-y` to `auto` as well. The result
        was a tab strip you could scroll vertically by exactly one pixel. Pulling the whole
        row down instead keeps the tabs flush inside it, so there is nothing to scroll.
      */}
      <div
        role='tablist'
        aria-label='Tabs'
        className='-mb-px flex min-w-0 shrink items-end gap-0.5'
      >
        {pinnedTabs.length > 0 && (
          <div className='flex shrink-0 items-end gap-0.5'>
            <AnimatePresence initial={false} mode='popLayout'>
              {pinnedTabs.map(renderTab)}
            </AnimatePresence>
          </div>
        )}
        <div className='relative flex min-w-0 shrink'>
          <div
            ref={scrollNodeRef}
            className='flex min-w-0 shrink select-none items-end gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
          >
            <AnimatePresence initial={false} mode='popLayout'>
              {regularTabs.map(renderTab)}
            </AnimatePresence>
          </div>
          {canScrollLeft && (
            <div className='pointer-events-none absolute inset-y-0 left-0 z-20 w-4 bg-gradient-to-r from-[var(--bg)] to-transparent' />
          )}
          {canScrollRight && (
            <div className='pointer-events-none absolute inset-y-0 right-0 z-20 w-4 bg-gradient-to-l from-[var(--bg)] to-transparent' />
          )}
        </div>
      </div>
      {onNew && (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              type='button'
              variant='ghost-secondary'
              size='sm'
              aria-label={newTabLabel}
              className='mb-px size-[30px] shrink-0 p-0'
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
