import { useCallback, useLayoutEffect, useRef } from 'react'

const NEAR_BOTTOM_THRESHOLD = 30

/**
 * Computes how much extra height the scroll-anchor spacer needs to maintain
 * the user's intended scroll position when replace-mode streaming temporarily
 * produces content shorter than that position.
 *
 * @param targetScrollTop - the scroll position the user intends to hold
 * @param clientHeight - visible height of the scroll container
 * @param scrollHeight - total scrollable height (including current spacer)
 * @param prevSpacerHeight - current spacer height (subtracted to get natural content height)
 * @returns the new `minHeight` value to apply to the spacer element, or 0 if none needed
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
 * Manages scroll for a streaming content container.
 *
 * Two modes based on whether the user has ever manually scrolled:
 *
 * **Never scrolled** — auto-follows new content to the bottom while
 * streaming (MutationObserver keeps it pinned). The user can scroll up to
 * detach; scrolling back to the bottom re-engages.
 *
 * **Has scrolled** — position is locked. The hook injects a spacer element
 * at the end of the container's content that inflates `scrollHeight` to at
 * least `intendedScrollTop + clientHeight` on every content update. This
 * prevents the browser from clamping `scrollTop` when replace-mode streaming
 * temporarily produces a chunk shorter than the previous content (which would
 * otherwise jump the viewport to the top before the content regrows).
 *
 * The "has scrolled" flag resets on unmount so each new chat / file gets a
 * clean slate (parent remounts on key change).
 *
 * @param isStreaming - whether the container is currently receiving streaming content
 * @param content - the current text content; drives the spacer recalculation
 */
export function useScrollAnchor(isStreaming: boolean, content?: string) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const spacerRef = useRef<HTMLDivElement | null>(null)
  const hasUserScrolledRef = useRef(false)
  const stickyRef = useRef(false)

  // The scroll position the user most recently settled on — updated only from
  // genuine user scroll events, never from programmatic ones.
  const intendedScrollTopRef = useRef(0)

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [])

  // ── event listeners ─────────────────────────────────────────────────────

  const onWheel = useCallback((e: WheelEvent) => {
    if (e.deltaY >= 0 || hasUserScrolledRef.current) return
    // User scrolled up before any scroll event fired — detach immediately.
    hasUserScrolledRef.current = true
    stickyRef.current = false
    const el = containerRef.current
    if (el) intendedScrollTopRef.current = el.scrollTop
  }, [])

  const onScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return

    if (hasUserScrolledRef.current) {
      // Track their position so we can restore it after a content-shrink event.
      intendedScrollTopRef.current = el.scrollTop
      return
    }

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom > NEAR_BOTTOM_THRESHOLD) {
      // User scrolled away from the bottom.
      hasUserScrolledRef.current = true
      stickyRef.current = false
      intendedScrollTopRef.current = el.scrollTop
    } else {
      // Re-engaged (scrolled back to bottom).
      stickyRef.current = true
    }
  }, [])

  // ── container ref callback ───────────────────────────────────────────────

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

  // ── stream-start: decide initial pin state ───────────────────────────────

  useLayoutEffect(() => {
    if (!isStreaming) return
    const el = containerRef.current
    if (!el) return

    if (hasUserScrolledRef.current) {
      // User has already scrolled — never override their position.
      return
    }

    // Fresh stream or user is at the bottom — engage sticky follow.
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    stickyRef.current = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD
    if (stickyRef.current) scrollToBottom()
  }, [isStreaming, scrollToBottom])

  // ── sticky follow: MutationObserver while streaming ──────────────────────

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

  // ── scroll-clip prevention via spacer ───────────────────────────────────
  //
  // On every content update, if the user has scrolled:
  //   1. Compute naturalScrollHeight (container height minus spacer contribution).
  //   2. Compute the minimum scrollHeight needed to keep intendedScrollTop valid.
  //   3. Set spacer.minHeight to fill any gap — this inflates scrollHeight before
  //      we read scrollTop, so the browser never clamps it to 0.
  //   4. Restore scrollTop if it was already clipped (e.g. by prior content).
  //
  // When the user has NOT scrolled: clear the spacer so it doesn't interfere
  // with auto-scroll bottom detection.

  useLayoutEffect(() => {
    const el = containerRef.current
    const spacer = spacerRef.current
    if (!el) return

    // Clear the spacer when the user hasn't scrolled (auto-follow mode) or when
    // streaming has ended (content is stable; no more clip-prevention needed).
    if (!hasUserScrolledRef.current || !isStreaming) {
      if (spacer) spacer.style.minHeight = '0'
      return
    }

    // Capture the target BEFORE any layout read. Reading layout properties
    // (clientHeight, scrollHeight, offsetHeight) forces a browser reflow. If
    // scrollHeight is already smaller than scrollTop + clientHeight, the browser
    // clamps scrollTop to 0 during that reflow and dispatches a 'scroll' event
    // synchronously. Our onScroll handler would then overwrite intendedScrollTopRef
    // with 0, corrupting the restore. Saving to a local variable here avoids that.
    const targetScrollTop = intendedScrollTopRef.current

    // Read spacer and scroll heights BEFORE mutating the spacer.
    const prevSpacerHeight = spacer ? spacer.offsetHeight : 0
    const shortage = computeSpacerShortage(
      targetScrollTop,
      el.clientHeight,
      el.scrollHeight,
      prevSpacerHeight
    )

    // Inflate spacer so scrollHeight >= needed, preventing scrollTop clamping.
    if (spacer) spacer.style.minHeight = `${shortage}px`

    // Restore scroll position (now valid because spacer ensures enough height).
    if (el.scrollTop < targetScrollTop) {
      el.scrollTop = targetScrollTop
    }
  }, [content, isStreaming])

  return {
    ref: callbackRef,
    spacerRef,
  }
}
