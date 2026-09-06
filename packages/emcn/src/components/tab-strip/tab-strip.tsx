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
import { overflowTextClipClass, overflowTextFadeClass } from '../overflow-text/overflow-text'
import { Tooltip } from '../tooltip/tooltip'

const DRAG_EDGE_ZONE = 40
const DRAG_SCROLL_SPEED = 8
const TITLE_TOOLTIP_HIDDEN_PX = 8
/**
 * Width of the scroll-edge fades, and so the margin a tab has to clear to be
 * genuinely visible. Keep in step with the `w-4` on the gradients below: a tab
 * revealed flush against the container edge lands under its gradient and reads
 * as half-faded, which is indistinguishable from "there is more to scroll".
 */
const EDGE_FADE_PX = 24

/**
 * Edge fades, as a mask rather than a tinted gradient laid over the tabs.
 *
 * Tabs paint their own fills, and an overlay tinted with the surface colour
 * washes a pill's edge toward that colour instead of dissolving it — and it is
 * only correct while whatever sits behind the strip is exactly that colour. A
 * mask fades pill and label together to real transparency, over any background.
 * This is how the command palette fades its results, and how every other
 * horizontal fade in the app is drawn.
 *
 * The four combinations are spelled out because Tailwind scans for literal class
 * strings; a template built at runtime would never be generated. Keep the 24px
 * stops in step with {@link EDGE_FADE_PX}, which is how far `revealActiveTab`
 * insets a tab so it lands clear of the fade rather than under it.
 */
const SCROLL_FADE = {
  none: '',
  start:
    '[-webkit-mask-image:linear-gradient(to_right,transparent_0px,black_24px)] [mask-image:linear-gradient(to_right,transparent_0px,black_24px)]',
  end: '[-webkit-mask-image:linear-gradient(to_right,black_calc(100%_-_24px),transparent_100%)] [mask-image:linear-gradient(to_right,black_calc(100%_-_24px),transparent_100%)]',
  both: '[-webkit-mask-image:linear-gradient(to_right,transparent_0px,black_24px,black_calc(100%_-_24px),transparent_100%)] [mask-image:linear-gradient(to_right,transparent_0px,black_24px,black_calc(100%_-_24px),transparent_100%)]',
} as const
const TAB_TRANSITION = { duration: 0.1, ease: [0.2, 0, 0, 1] as const }

/**
 * Width, not flex-basis: `flex-1` compiles to `flex: 1 1 0%`, and Tailwind emits
 * the `flex` shorthand after `flex-basis`, so pairing the two silently discarded
 * the basis and left every tab sized by its own title.
 *
 * `attached` gives every tab the same width and a floor, so a crowded strip
 * degrades evenly and then scrolls. `floating` sizes to content up to a cap, so
 * short labels stay short and only a long one ellipsizes — a row of bare labels
 * must not read as a grid of buttons.
 *
 * Both refuse to shrink below their floor, and that is what makes the strip
 * scrollable at all: a flex child that is both shrinkable and `min-w-0` compresses
 * to fit its container instead of overflowing it, so `scrollWidth` never exceeds
 * `clientWidth`, the edge fades never appear, and every label crushes to an
 * ellipsis. `floating` therefore never shrinks; `attached` shrinks only to 96px.
 */
const TAB_WIDTH: Record<TabStripVariant, string> = {
  attached: 'w-[156px] min-w-[96px] shrink',
  floating: 'max-w-[var(--tab-strip-max-tab-width,200px)] shrink-0',
}

/** The resting shape of a tab that is not the active one. */
const TAB_SHAPE: Record<TabStripVariant, string> = {
  attached: 'rounded-b-none border border-transparent border-b-0',
  // No shape at all at rest: bare labels, so the row reads as one quiet line
  // rather than a strip of buttons competing with the panel's own controls. A
  // shape appears on hover, which is where the close affordance lives.
  floating:
    'rounded-lg text-[var(--text-secondary)] hover-hover:bg-[var(--surface-hover)] hover-hover:text-[var(--text-primary)]',
}

/**
 * The active tab. `attached` fills with the page background and keeps a border,
 * having already dropped its bottom edge to merge into the surface below;
 * `floating` has no surface to merge with, so it reads by fill alone.
 */
const TAB_ACTIVE: Record<TabStripVariant, string> = {
  attached:
    'hover-hover:border-[var(--border)]! hover-hover:bg-[var(--bg)]! hover-hover:text-[var(--text-primary)]! hover-hover:brightness-100! hover-hover:opacity-100! border-[var(--border)] bg-[var(--bg)] text-[var(--text-primary)] transition-none',
  floating:
    'hover-hover:bg-[var(--surface-active)]! hover-hover:text-[var(--text-primary)]! bg-[var(--surface-active)] text-[var(--text-primary)]',
}

/**
 * A tab held in a multi-selection that is not the one on screen. `attached` can
 * reuse `--surface-active` because its active tab reads by border and page
 * background instead. `floating`'s ramp has four rungs and each token does the
 * job it is named for: bare is transparent, hover is `--surface-hover`, active
 * is `--surface-active`, and a selected tab takes the one rung left between
 * them. Keep them in that order — the fills are 3 hex steps apart, so swapping
 * any two makes a state read as another.
 */
const TAB_SELECTED: Record<TabStripVariant, string> = {
  attached: 'bg-[var(--surface-active)]',
  floating: 'bg-[var(--surface-4)]',
}

/** Whether a tab draws no shape of its own, and so needs dividing from its neighbour. */
function isBareTab(tab: TabStripItem | undefined): boolean {
  return Boolean(tab) && !tab?.active && !tab?.selected
}

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
   * Belongs to a multi-tab selection without being the tab on screen. Renders
   * as a secondary highlight on `--surface-active` — the token the app already
   * uses for a selected row — so it never competes with the active tab, which
   * stays the only one merged into the surface below.
   */
  selected?: boolean
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

/** Handed to {@link TabStripBaseProps.onTabDragStart} to shape the gesture it starts. */
export interface TabStripDragContext {
  /**
   * Declares that this gesture is not a reorder — a drag carrying a whole
   * multi-tab selection out of the strip, say. The strip drops its own drag
   * tracking, so no drop indicator, no edge auto-scroll and no `onReorder`
   * follow.
   */
  preventReorder: () => void
}

/**
 * How the tabs are drawn.
 *
 * - `attached` — browser-style. Every tab is a shape, and the active one loses
 *   its bottom border to merge into the surface below. For a strip that owns
 *   the whole surface under it.
 * - `floating` — only the active tab carries a shape; the rest are bare labels
 *   divided by a hairline. Quieter, and it does not claim the surface below, so
 *   it suits a panel header that sits above content it does not own.
 */
export type TabStripVariant = 'attached' | 'floating'

/** How a tab selection was initiated. */
export type TabStripSelectionSource = 'pointer' | 'keyboard'

/**
 * The new-tab slot holds either the built-in button or a caller's own control,
 * never both — a supplied control owns its own label and limit, so `onNew`,
 * `newTabLabel` and `maxTabs` are not merely ignored alongside it, they are
 * rejected.
 */
type TabStripNewTabProps =
  | {
      /** Omit to hide the new-tab button. */
      onNew?: () => void
      newTabLabel?: string
      /** Disables the new-tab button, with a tooltip explaining why. */
      maxTabs?: number
      newTabControl?: never
    }
  | {
      /**
       * Replaces the built-in new-tab button for a strip whose "new" action opens
       * a menu rather than acting on click. It takes the same slot, so it keeps
       * its place beside the last tab and inside the wheel-scroll region.
       */
      newTabControl: ReactNode
      onNew?: never
      newTabLabel?: never
      maxTabs?: never
    }

export type TabStripProps = TabStripBaseProps & TabStripNewTabProps

interface TabStripBaseProps {
  tabs: TabStripItem[]
  /**
   * The originating click is forwarded so a caller can layer modifier
   * behaviour — shift for a range, cmd/ctrl to toggle — over plain selection.
   */
  onSelect: (
    id: string,
    source?: TabStripSelectionSource,
    event?: ReactMouseEvent<HTMLButtonElement>
  ) => void
  /** Omit to make tabs uncloseable. Never offered for a pinned tab. */
  onClose?: (id: string) => void
  /** Enables drag reordering. Receives the tab's final index. */
  onReorder?: (id: string, targetIndex: number) => void
  onTabContextMenu?: (event: ReactMouseEvent<HTMLDivElement>, id: string) => void
  /**
   * Called as a tab starts being dragged, to add whatever that tab means
   * outside the strip to the drag. Supplying it also makes tabs draggable in a
   * strip that cannot be reordered.
   *
   * The `drag` handle lets it declare that the gesture is not a reorder at all;
   * see {@link TabStripDragContext.preventReorder}.
   */
  onTabDragStart?: (
    event: ReactDragEvent<HTMLDivElement>,
    id: string,
    drag: TabStripDragContext
  ) => void
  /** In-flow controls pinned to the far end, past the tabs and the new-tab slot. */
  endActions?: ReactNode
  /**
   * Out-of-flow content that has to live inside the strip — a context menu
   * anchored to a tab, say. Rendered last and contributing no layout, which is
   * what separates it from {@link TabStripBaseProps.endActions}.
   */
  overlays?: ReactNode
  /** Defaults to `attached`. See {@link TabStripVariant}. */
  variant?: TabStripVariant
  /**
   * Merged onto the strip root. Intended for the geometry custom properties
   * below rather than for competing utility classes, so a caller that owns the
   * surrounding header can size the strip without fighting its base classes:
   *
   * - `--tab-strip-height` (default `34px`) — the strip's own height.
   * - `--tab-strip-band` (default `30px`) — the height of the tabs and the
   *   controls beside them, which is the band an overlaid control must match.
   * - `--tab-strip-inline-start` / `--tab-strip-inline-end` (default `8px`).
   * - `--tab-strip-max-tab-width` (default `200px`) — the width a `floating`
   *   tab's label ellipsizes at. `attached` is fixed-width and ignores it.
   */
  className?: string
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

/**
 * Selector matching a tab's outer element. Part of the strip's API: a caller
 * building its own drag image needs the real, laid-out nodes to snapshot, and
 * this keeps it from hardcoding the attribute.
 */
export function tabStripItemSelector(id: string): string {
  return `[data-tab-strip-item="${CSS.escape(id)}"]`
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
  variant: TabStripVariant
  /**
   * Draws the hairline that separates two adjacent bare tabs in the `floating`
   * variant. Suppressed next to a tab that has a shape of its own, since the
   * shape already does the dividing.
   */
  showDivider: boolean
  onSelect: (
    id: string,
    source?: TabStripSelectionSource,
    event?: ReactMouseEvent<HTMLButtonElement>
  ) => void
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
    variant,
    showDivider,
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
      animate={{ opacity: 1, scale: 1 }}
      exit={reduceMotion ? undefined : { opacity: 0, scale: 0.98 }}
      transition={TAB_TRANSITION}
      className={cn(
        'group relative select-none',
        // `shrink` lets a crowded strip squeeze tabs to their floor before it
        // starts scrolling.
        tab.pinned ? 'w-[34px] min-w-[34px] max-w-[34px] flex-none' : TAB_WIDTH[variant],
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
      {showDivider && (
        <div className='-translate-y-1/2 -left-1 pointer-events-none absolute top-1/2 h-4 w-px bg-[var(--border)]' />
      )}
      {showDropBefore && (
        <div className='-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-0 z-30 h-4 w-[2px] rounded-full bg-[var(--text-subtle)]' />
      )}
      {showDropAfter && (
        <div className='-translate-y-1/2 pointer-events-none absolute top-1/2 right-0 z-30 h-4 w-[2px] translate-x-1/2 rounded-full bg-[var(--text-subtle)]' />
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
              'h-[var(--tab-strip-band,30px)] w-full select-none bg-transparent py-0 text-caption',
              tab.pinned ? 'justify-center px-0' : 'justify-start gap-1.5 px-2',
              closeable && 'pr-8',
              TAB_SHAPE[variant],
              tab.selected && !tab.active && TAB_SELECTED[variant],
              tab.active && 'relative z-10',
              tab.active && TAB_ACTIVE[variant]
            )}
            onClick={(event) => onSelect(tab.id, 'pointer', event)}
            onKeyDown={(event) => onKeyDown(event, tab.id)}
          >
            {tab.icon}
            {!tab.pinned && (
              <span
                ref={titleRef}
                className={cn(
                  overflowTextClipClass,
                  'flex-1 select-none text-left',
                  titleTruncated && overflowTextFadeClass
                )}
              >
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
            '-translate-y-1/2 absolute top-1/2 right-0.5 z-20 size-[24px] p-0 transition-opacity',
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
  newTabControl,
  endActions,
  overlays,
  variant = 'attached',
  className,
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
    // Inset by the fade on both sides so the tab comes to rest clear of the
    // gradient rather than beneath it.
    const viewLeft = node.scrollLeft + EDGE_FADE_PX
    const viewRight = node.scrollLeft + node.clientWidth - EDGE_FADE_PX
    const maxScrollLeft = Math.max(0, node.scrollWidth - node.clientWidth)
    const target =
      tabLeft < viewLeft
        ? tabLeft - EDGE_FADE_PX
        : tabRight > viewRight
          ? tabRight - node.clientWidth + EDGE_FADE_PX
          : null
    if (target === null) return
    // The clamp is what lets the first and last tabs sit flush: there is no
    // gradient at a scroll extreme, so no margin is needed to clear one.
    const nextLeft = Math.max(0, Math.min(maxScrollLeft, target))
    if (Math.abs(nextLeft - node.scrollLeft) < 1) return
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
      // owns the tabs, so they attach it, and they may decline the reorder the
      // strip just started tracking.
      let reorderPrevented = false
      onTabDragStart?.(event, id, {
        preventReorder: () => {
          reorderPrevented = true
        },
      })
      if (reorderPrevented) {
        draggedIdRef.current = null
        setDraggedId(null)
      }
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

  // Called as a `map` callback, so `lane` is whichever of the two rows — pinned
  // or regular — is being rendered. The neighbour has to come from that lane
  // rather than from `tabs`: the rows are separate containers, so a tab's
  // predecessor in the combined list may not be the one beside it on screen, and
  // the first tab in a lane has no on-screen predecessor at all.
  const renderTab = (tab: TabStripItem, laneIndex: number, lane: TabStripItem[]) => {
    const index = tabs.findIndex((candidate) => candidate.id === tab.id)
    // A hairline stands between two adjacent bare tabs only. A tab that carries
    // a shape — the active one, or one held in a multi-selection — already
    // separates itself, and doubling up reads as a seam.
    const previous = lane[laneIndex - 1]
    return (
      <Tab
        key={tab.id}
        tab={tab}
        variant={variant}
        showDivider={variant === 'floating' && isBareTab(tab) && isBareTab(previous)}
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
      // Geometry reads from custom properties with defaults baked into the
      // `var()` calls, so a caller resizes the strip by setting a property
      // rather than by passing a utility class that has to out-merge this one.
      className={cn(
        'flex h-[var(--tab-strip-height,34px)] shrink-0 select-none gap-1 border-[var(--border)] border-b bg-transparent pr-[var(--tab-strip-inline-end,8px)] pl-[var(--tab-strip-inline-start,8px)]',
        // Attached tabs hang from the top so the active one can reach the strip's
        // bottom border and cover it; floating tabs are centred in the bar.
        variant === 'attached' ? 'items-end pt-1' : 'items-center',
        className
      )}
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
        className={cn(
          'flex min-w-0 shrink gap-0.5',
          variant === 'attached' ? '-mb-px items-end' : 'items-center gap-2'
        )}
      >
        {pinnedTabs.length > 0 && (
          <div
            className={cn(
              'flex shrink-0 gap-0.5',
              variant === 'attached' ? 'items-end' : 'items-center gap-2'
            )}
          >
            <AnimatePresence initial={false} mode='popLayout'>
              {pinnedTabs.map(renderTab)}
            </AnimatePresence>
          </div>
        )}
        <div className='flex min-w-0 shrink'>
          <div
            ref={scrollNodeRef}
            className={cn(
              'flex min-w-0 shrink select-none gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
              variant === 'attached' ? 'items-end' : 'items-center gap-2',
              SCROLL_FADE[
                canScrollLeft
                  ? canScrollRight
                    ? 'both'
                    : 'start'
                  : canScrollRight
                    ? 'end'
                    : 'none'
              ]
            )}
          >
            <AnimatePresence initial={false} mode='popLayout'>
              {regularTabs.map(renderTab)}
            </AnimatePresence>
          </div>
        </div>
      </div>
      {/* Both slots sit in the tab row's band so whatever fills them lines up
          with the tabs rather than with the taller strip box. */}
      {newTabControl ? (
        <div
          className={cn(
            'flex h-[var(--tab-strip-band,30px)] shrink-0 items-center',
            variant === 'attached' && 'mb-px'
          )}
        >
          {newTabControl}
        </div>
      ) : onNew ? (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              type='button'
              variant='ghost-secondary'
              size='sm'
              aria-label={newTabLabel}
              className={cn(
                'size-[var(--tab-strip-band,30px)] shrink-0 p-0',
                variant === 'attached' && 'mb-px'
              )}
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
      ) : null}
      {endActions && (
        <div
          className={cn(
            'ml-auto flex h-[var(--tab-strip-band,30px)] shrink-0 items-center gap-1',
            variant === 'attached' && 'mb-px'
          )}
        >
          {endActions}
        </div>
      )}
      {overlays}
    </div>
  )
}
