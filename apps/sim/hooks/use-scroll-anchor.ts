import { useCallback, useLayoutEffect, useRef } from 'react'

const NEAR_BOTTOM_THRESHOLD = 30

/**
 * Returns the `minHeight` the spacer needs so `scrollTop` can safely reach
 * `targetScrollTop` when replace-mode streaming produces temporarily shorter content.
 */
export function computeSpacerShortage(
  targetScrollTop: number,
  clientHeight: number,
  scrollHeight: number,
  prevSpacerHeight: number
): number {
  const needed = targetScrollTop + clientHeight
  const naturalScrollHeight = scrollHeight - prevSpacerHeight
  return Math.max(0, needed - naturalScrollHeight)
}

/**
 * Returns whether the scroll container should re-engage auto-follow.
 *
 * Re-engagement is blocked while the spacer is active. The spacer inflates
 * `scrollHeight` to exactly `targetScrollTop + clientHeight`, so programmatic
 * scroll restoration produces `distanceFromBottom = 0` — which is artificial
 * proximity, not the user genuinely reaching the document bottom.
 */
export function shouldReengage(distanceFromBottom: number, spacerHeight: number): boolean {
  return distanceFromBottom <= NEAR_BOTTOM_THRESHOLD && spacerHeight === 0
}

/**
 * Manages scroll for a streaming file-preview container.
 *
 * Never-scrolled: auto-follows new content to the bottom (MutationObserver
 * keeps it pinned). Scrolled-up: position is locked via a spacer element that
 * inflates `scrollHeight` to prevent the browser from clamping `scrollTop` when
 * replace-mode streaming temporarily produces a shorter chunk. Scrolled back to
 * the bottom: auto-follow re-engages.
 *
 * @param isStreaming - whether the container is currently receiving streaming content
 * @param content - drives spacer recalculation; pass the current text value
 */
export function useScrollAnchor(isStreaming: boolean, content?: string) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const spacerRef = useRef<HTMLDivElement | null>(null)
  const hasUserScrolledRef = useRef(false)
  const stickyRef = useRef(false)
  const intendedScrollTopRef = useRef(0)
  // Avoids a layout read inside onScroll.
  const spacerHeightRef = useRef(0)

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [])

  const onWheel = useCallback((e: WheelEvent) => {
    if (e.deltaY >= 0 || hasUserScrolledRef.current) return
    hasUserScrolledRef.current = true
    stickyRef.current = false
    const el = containerRef.current
    if (el) intendedScrollTopRef.current = el.scrollTop
  }, [])

  const onScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return

    if (hasUserScrolledRef.current) {
      intendedScrollTopRef.current = el.scrollTop
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      if (shouldReengage(distanceFromBottom, spacerHeightRef.current)) {
        hasUserScrolledRef.current = false
        stickyRef.current = true
      }
      return
    }

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom > NEAR_BOTTOM_THRESHOLD) {
      hasUserScrolledRef.current = true
      stickyRef.current = false
      intendedScrollTopRef.current = el.scrollTop
    } else {
      stickyRef.current = true
    }
  }, [])

  const callbackRef = useCallback(
    (el: HTMLDivElement | null) => {
      const prev = containerRef.current
      if (prev) {
        prev.removeEventListener('scroll', onScroll)
        prev.removeEventListener('wheel', onWheel as EventListener)
      }
      containerRef.current = el
      if (el) {
        el.addEventListener('scroll', onScroll, { passive: true })
        el.addEventListener('wheel', onWheel as EventListener, { passive: true })
      }
    },
    [onScroll, onWheel]
  )

  useLayoutEffect(() => {
    if (!isStreaming) return
    const el = containerRef.current
    if (!el) return
    if (hasUserScrolledRef.current) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickyRef.current = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD
    if (stickyRef.current) scrollToBottom()
  }, [isStreaming, scrollToBottom])

  useLayoutEffect(() => {
    if (!isStreaming) return
    const el = containerRef.current
    if (!el) return

    let rafId = 0
    const guardedScroll = () => {
      if (stickyRef.current) scrollToBottom()
    }
    const onMutation = () => {
      if (!stickyRef.current) return
      cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(guardedScroll)
    }

    const observer = new MutationObserver(onMutation)
    observer.observe(el, { childList: true, subtree: true, characterData: true })

    return () => {
      observer.disconnect()
      cancelAnimationFrame(rafId)
    }
  }, [isStreaming, scrollToBottom])

  useLayoutEffect(() => {
    const el = containerRef.current
    const spacer = spacerRef.current
    if (!el) return

    if (!hasUserScrolledRef.current || !isStreaming) {
      spacerHeightRef.current = 0
      if (spacer) spacer.style.minHeight = '0'
      return
    }

    // Must read before scrollHeight: that forced reflow can synchronously fire 'scroll' and clamp the value.
    const targetScrollTop = intendedScrollTopRef.current

    const prevSpacerHeight = spacer ? spacer.offsetHeight : 0
    const shortage = computeSpacerShortage(
      targetScrollTop,
      el.clientHeight,
      el.scrollHeight,
      prevSpacerHeight
    )

    spacerHeightRef.current = shortage
    if (spacer) spacer.style.minHeight = `${shortage}px`
    if (el.scrollTop < targetScrollTop) el.scrollTop = targetScrollTop
  }, [content, isStreaming])

  return {
    ref: callbackRef,
    spacerRef,
  }
}
