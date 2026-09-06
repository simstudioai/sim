import { type RefObject, useEffect, useState } from 'react'
import type { ScrollEdges } from '../components/scroll-fade/scroll-fade'

/**
 * Sub-pixel scroll positions and rounding leave `scrollTop` or the remaining
 * distance fractionally above zero at rest; anything within this is "at the edge".
 */
const EDGE_TOLERANCE_PX = 1

const AT_REST: ScrollEdges = { top: false, bottom: false }

interface UseScrollEdgesOptions {
  /**
   * The element whose size changes when the region's content changes, when it is
   * not the region's first child. Watched alongside the region so the edges
   * update as rows arrive or leave, not only on scroll.
   */
  contentRef?: RefObject<HTMLElement | null>
  /** Set false while the region is not on screen; both edges then read false. */
  enabled?: boolean
}

/**
 * Whether a scroll region hides content beyond its top or bottom edge. Tracks
 * scrolling and resizes of the region and its content, so the answer stays right
 * as rows arrive, leave, or the viewport changes.
 *
 * Drives both the edge fade ({@link scrollFadeClass}) and any divider that should
 * appear only once rows are hidden behind it.
 *
 * `target` is the region as a ref, or as the element itself. Pass the element
 * (held in state from a callback ref) when the region mounts later than the
 * component calling the hook — a Radix menu's content, say, lands one commit after
 * the menu opens, by which time an effect keyed on a ref has already run and found
 * it empty. An element in the dependency list re-runs the effect on attach.
 */
export function useScrollEdges(
  target: RefObject<HTMLElement | null> | HTMLElement | null,
  { contentRef, enabled = true }: UseScrollEdgesOptions = {}
): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>(AT_REST)

  useEffect(() => {
    const container = target instanceof HTMLElement ? target : target?.current
    if (!enabled || !container) {
      setEdges(AT_REST)
      return
    }

    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const top = scrollTop > EDGE_TOLERANCE_PX
      const bottom = scrollHeight - clientHeight - scrollTop > EDGE_TOLERANCE_PX
      setEdges((current) =>
        current.top === top && current.bottom === bottom ? current : { top, bottom }
      )
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
  }, [target, contentRef, enabled])

  return edges
}
