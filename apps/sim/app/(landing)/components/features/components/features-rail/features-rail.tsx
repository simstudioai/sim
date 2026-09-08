'use client'

import { Children, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import { EdgeFade } from '@/app/(landing)/components/shared/edge-fade'

/**
 * Breaks the rail out of the 10/12 inset to the section's edges. The section
 * is a size container (`container-type: inline-size`), so `50cqw - 50%` is
 * exactly the inset's offset from the section edge: as a negative margin it
 * spans the rail edge to edge, and the same value as padding keeps the first
 * card aligned with the heading while cards clip at the viewport rather than
 * at the inset.
 */
const RAIL_BLEED = '-mx-[calc(50cqw_-_50%)] px-[calc(50cqw_-_50%)]'

/**
 * The edge-fade overlay, stretched over the same edge-to-edge span the rail
 * bleeds to. The overlay is positioned against the rail's wrapper, which keeps
 * the inset width, so `50%` here is the same half-inset {@link RAIL_BLEED}
 * subtracts - pulling each side out to the section edge. Above the cards
 * (below the navbar's `z-50`) and transparent to the pointer, so the fade only
 * ever paints.
 */
const RAIL_EDGE_SPAN =
  'pointer-events-none absolute inset-y-0 z-10 left-[calc(50%_-_50cqw)] right-[calc(50%_-_50cqw)]'

/** One card slot: fixed responsive width. */
const SLOT_CLASS = 'w-[min(78vw,420px)] shrink-0 max-sm:w-[84vw]'

/** Pointer travel before a mouse press on the rail becomes a drag instead of a click. */
const DRAG_THRESHOLD_PX = 6

/**
 * A fold moves the position by a whole set width, so anything smaller than
 * this is floating-point noise from re-deriving an in-range position.
 */
const FOLD_TOLERANCE = 1

type Copy = 'lead' | 'home' | 'tail'

/**
 * Folds a scroll position back into the loop's home range. Three copies of the
 * set sit side by side; the position is kept between half a set and a set and
 * a half in, so a full set of cards is always waiting on either side and every
 * fold - an exact set width, onto identical content - is invisible. A
 * `setWidth` of 0 means the loop is not measurable (no layout), so the position
 * is left alone.
 */
export function foldScrollLeft(scrollLeft: number, setWidth: number): number {
  if (setWidth <= 0) return scrollLeft
  const from = setWidth / 2
  const offset = (((scrollLeft - from) % setWidth) + setWidth) % setWidth
  return from + offset
}

interface SlotsProps {
  copy: Copy
  cards: ReactNode[]
}

/**
 * One copy of the set as flat flex children, so the gap between copies equals
 * the gap between cards and the loop's period is exactly one set width. Clones
 * stay clickable but leave the accessibility tree.
 */
function Slots({ copy, cards }: SlotsProps) {
  const clone = copy !== 'home'
  return (
    <>
      {cards.map((card, index) => (
        <div
          key={`${copy}-${index}`}
          data-copy={copy}
          aria-hidden={clone ? 'true' : undefined}
          className={SLOT_CLASS}
        >
          {card}
        </div>
      ))}
    </>
  )
}

interface FeaturesRailProps {
  /** Accessible name of the scrolling region. */
  label: string
  /**
   * The cards, in order. Each becomes one slot; once JS runs the whole set is
   * cloned on both sides so the rail loops.
   */
  children: ReactNode
}

/**
 * The homepage product rail: native horizontal scrolling that never ends.
 *
 * The server renders the set once, so the HTML - and any visit without JS - is
 * the plain finite rail with the first card under the heading. After hydration
 * the set is cloned once on each side, the scroll position jumps one set width
 * before paint so nothing visibly moves (folded, so Strict Mode's second run of
 * the effect lands on the same spot), and a passive scroll listener folds the
 * position back into the middle copy whenever it drifts half a set past it. The fold is an exact set width onto identical content, so the space
 * left of the first card is always the tail of the set and scrolling in either
 * direction never meets an end.
 *
 * Wheel, trackpad, touch, and keyboard all drive the native scroller with no
 * snapping to fight them, so the rail scrolls the same whether or not the
 * pointer is over a card. A mouse can also drag the rail: past a small
 * threshold the press scrolls by the pointer's movement (as deltas, so a fold
 * mid-drag is harmless), the click that would follow is swallowed, and native
 * link and image drags are off. Clones stay clickable but sit outside the tab
 * order and the accessibility tree, so keyboard and screen-reader users meet
 * each product exactly once.
 *
 * Both screen edges blur and fade into the page ground ({@link EdgeFade}), the
 * same treatment the product-demo stage wears, so a card leaving the rail
 * softens away instead of being cut off at the viewport.
 */
export function FeaturesRail({ label, children }: FeaturesRailProps) {
  const railRef = useRef<HTMLDivElement>(null)
  const setWidthRef = useRef(0)
  const [looping, setLooping] = useState(false)
  const cards = Children.toArray(children)

  useEffect(() => {
    setLooping(true)
  }, [])

  useLayoutEffect(() => {
    if (!looping) return
    const rail = railRef.current
    if (!rail) return

    const measure = () => {
      const lead = rail.querySelector<HTMLElement>('[data-copy="lead"]')
      const home = rail.querySelector<HTMLElement>('[data-copy="home"]')
      setWidthRef.current = lead && home ? home.offsetLeft - lead.offsetLeft : 0
    }
    const fold = () => {
      const next = foldScrollLeft(rail.scrollLeft, setWidthRef.current)
      if (Math.abs(next - rail.scrollLeft) > FOLD_TOLERANCE) rail.scrollLeft = next
    }

    for (const link of rail.querySelectorAll<HTMLElement>(
      '[data-copy="lead"] a, [data-copy="tail"] a'
    )) {
      link.tabIndex = -1
    }
    measure()
    rail.scrollLeft = foldScrollLeft(rail.scrollLeft + setWidthRef.current, setWidthRef.current)
    rail.addEventListener('scroll', fold, { passive: true })
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(() => {
            measure()
            fold()
          })
    observer?.observe(rail)

    return () => {
      rail.removeEventListener('scroll', fold)
      observer?.disconnect()
    }
  }, [looping])

  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    let pointerId: number | null = null
    let startX = 0
    let lastX = 0
    let dragged = false
    let suppressNextClick = false

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return
      pointerId = event.pointerId
      startX = event.clientX
      lastX = event.clientX
      dragged = false
      suppressNextClick = false
    }
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return
      if (!dragged) {
        if (Math.abs(event.clientX - startX) < DRAG_THRESHOLD_PX) return
        dragged = true
        rail.dataset.dragging = ''
        rail.setPointerCapture?.(event.pointerId)
      }
      rail.scrollLeft -= event.clientX - lastX
      lastX = event.clientX
    }
    const onPointerEnd = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return
      pointerId = null
      suppressNextClick = event.type === 'pointerup' && dragged
      dragged = false
      delete rail.dataset.dragging
      if (rail.hasPointerCapture?.(event.pointerId)) rail.releasePointerCapture(event.pointerId)
    }
    const onClick = (event: MouseEvent) => {
      const suppress = suppressNextClick && event.detail > 0
      suppressNextClick = false
      if (!suppress) return
      event.preventDefault()
      event.stopPropagation()
    }
    const onDragStart = (event: DragEvent) => event.preventDefault()

    rail.addEventListener('pointerdown', onPointerDown)
    rail.addEventListener('pointermove', onPointerMove)
    rail.addEventListener('pointerup', onPointerEnd)
    rail.addEventListener('pointercancel', onPointerEnd)
    rail.addEventListener('click', onClick, true)
    rail.addEventListener('dragstart', onDragStart)
    return () => {
      rail.removeEventListener('pointerdown', onPointerDown)
      rail.removeEventListener('pointermove', onPointerMove)
      rail.removeEventListener('pointerup', onPointerEnd)
      rail.removeEventListener('pointercancel', onPointerEnd)
      rail.removeEventListener('click', onClick, true)
      rail.removeEventListener('dragstart', onDragStart)
    }
  }, [])

  return (
    <div className='relative'>
      <div
        ref={railRef}
        aria-label={label}
        className={cn(
          'flex gap-6 overflow-x-auto overscroll-x-contain pb-4 [overflow-anchor:none] [scrollbar-width:none] data-[dragging]:cursor-grabbing data-[dragging]:select-none [&::-webkit-scrollbar]:hidden',
          RAIL_BLEED
        )}
      >
        {looping && <Slots copy='lead' cards={cards} />}
        <Slots copy='home' cards={cards} />
        {looping && <Slots copy='tail' cards={cards} />}
      </div>
      <div className={RAIL_EDGE_SPAN}>
        <EdgeFade ground='canvas' edges={['left', 'right']} depth='bleed' />
      </div>
    </div>
  )
}
