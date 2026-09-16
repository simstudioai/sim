import { type RefObject, useEffect, useState } from 'react'
import type { ScrollEdges, ScrollEdgesX } from '../components/scroll-fade/scroll-fade'

/**
 * Sub-pixel scroll positions and rounding leave `scrollTop` or the remaining
 * distance fractionally above zero at rest; anything within this is "at the edge".
 */
const EDGE_TOLERANCE_PX = 1

const AT_REST: ScrollEdges = { top: false, bottom: false }
const AT_REST_X: ScrollEdgesX = { left: false, right: false }

interface UseScrollEdgesOptions {
  /**
   * The element whose size changes when the region's content changes, when it is
   * not the region's first child. Watched alongside the region so the edges
   * update as rows arrive or leave, not only on scroll.
   */
  contentRef?: RefObject<HTMLElement | null>
  /** Set false while the region is not on screen; both edges then read false. */
  enabled?: boolean
  /** The direction the region scrolls. Vertical unless told otherwise. */
  axis?: 'x' | 'y'
}

/** The hidden-content test for one axis, read off the region's scroll metrics. */
function readEdges(container: HTMLElement, axis: 'x' | 'y'): [start: boolean, end: boolean] {
  const position = axis === 'x' ? container.scrollLeft : container.scrollTop
  const size = axis === 'x' ? container.scrollWidth : container.scrollHeight
  const viewport = axis === 'x' ? container.clientWidth : container.clientHeight
  return [position > EDGE_TOLERANCE_PX, size - viewport - position > EDGE_TOLERANCE_PX]
}

/**
 * Whether a scroll region hides content beyond its edges. Tracks scrolling and
 * resizes of the region and its content, so the answer stays right as rows
 * arrive, leave, or the viewport changes.
 *
 * Drives both the edge fade ({@link scrollFadeClass}, or {@link scrollFadeXClass}
 * for a sideways region) and any divider that should appear only once content is
 * hidden behind it.
 *
 * `target` is the region as a ref, or as the element itself. Pass the element
 * (held in state from a callback ref) when the region mounts later than the
 * component calling the hook — a Radix menu's content, say, lands one commit after
 * the menu opens, by which time an effect keyed on a ref has already run and found
 * it empty. An element in the dependency list re-runs the effect on attach.
 */
export function useScrollEdges(
  target: RefObject<HTMLElement | null> | HTMLElement | null,
  options: UseScrollEdgesOptions & { axis: 'x' }
): ScrollEdgesX
export function useScrollEdges(
  target: RefObject<HTMLElement | null> | HTMLElement | null,
  options?: UseScrollEdgesOptions & { axis?: 'y' }
): ScrollEdges
export function useScrollEdges(
  target: RefObject<HTMLElement | null> | HTMLElement | null,
  { contentRef, enabled = true, axis = 'y' }: UseScrollEdgesOptions = {}
): ScrollEdges | ScrollEdgesX {
  const [edges, setEdges] = useState<[start: boolean, end: boolean]>([false, false])

  useEffect(() => {
    const container = target instanceof HTMLElement ? target : target?.current
    if (!enabled || !container) {
      setEdges([false, false])
      return
    }

    const update = () => {
      const [start, end] = readEdges(container, axis)
      setEdges((current) => (current[0] === start && current[1] === end ? current : [start, end]))
    }

    update()
    container.addEventListener('scroll', update, { passive: true })

    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update)
    observer?.observe(container)
    const content = contentRef?.current ?? container.firstElementChild
    if (content) observer?.observe(content)

    return () => {
      container.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [target, contentRef, enabled, axis])

  const [start, end] = edges
  if (axis === 'x') return start || end ? { left: start, right: end } : AT_REST_X
  return start || end ? { top: start, bottom: end } : AT_REST
}
