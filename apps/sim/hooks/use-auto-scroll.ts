import { useCallback, useEffect, useRef } from 'react'

/** Tolerance for keeping stickiness during programmatic auto-scroll. */
const STICK_THRESHOLD = 30
/** User must scroll back to within this distance to re-engage auto-scroll. */
const REATTACH_THRESHOLD = 5
/**
 * A keyboard-driven scroll (PageUp, arrows) only emits `scroll` events, so its
 * detach is honored when it lands within this window of a `keydown`. Wheel and
 * touch detach directly via their own handlers, and scrollbar drags are tracked
 * through {@link pointerDownRef}, so neither feeds this window.
 *
 * The guard exists because virtualizers (react-virtual) programmatically move
 * `scrollTop` to keep content stable when a measured row's size changes —
 * including the transient height *shrinks* a streaming markdown renderer emits as
 * it re-parses each token. Without it, that upward programmatic scroll is misread
 * as the user scrolling away and auto-scroll detaches mid-stream.
 */
const USER_GESTURE_WINDOW = 250

interface UseAutoScrollOptions {
  scrollOnMount?: boolean
}

/**
 * Manages sticky auto-scroll for a streaming chat container.
 *
 * Stays pinned to the bottom while content streams in. Detaches immediately
 * on any upward user gesture (wheel, touch, scrollbar drag). Once detached,
 * the user must scroll back to within {@link REATTACH_THRESHOLD} of the
 * bottom to re-engage.
 *
 * Returns `ref` (callback ref for the scroll container) and `scrollToBottom`
 * for imperative use after layout-changing events like panel expansion.
 */
export function useAutoScroll(
  isStreaming: boolean,
  { scrollOnMount = false }: UseAutoScrollOptions = {}
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)
  const userDetachedRef = useRef(false)
  const prevScrollTopRef = useRef(0)
  const prevScrollHeightRef = useRef(0)
  const touchStartYRef = useRef(0)
  const rafIdRef = useRef(0)
  const scrollOnMountRef = useRef(scrollOnMount)
  const pointerDownRef = useRef(false)
  const lastUserGestureAtRef = useRef(Number.NEGATIVE_INFINITY)

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [])

  const callbackRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el
    if (el && scrollOnMountRef.current) el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    if (!isStreaming) return
    const el = containerRef.current
    if (!el) return

    // Don't jump if the user scrolled up — keep their position.
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const isNearBottom = distanceFromBottom <= STICK_THRESHOLD
    stickyRef.current = isNearBottom
    userDetachedRef.current = !isNearBottom
    prevScrollTopRef.current = el.scrollTop
    prevScrollHeightRef.current = el.scrollHeight
    if (isNearBottom) scrollToBottom()

    const detach = () => {
      stickyRef.current = false
      userDetachedRef.current = true
    }

    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0) detach()
    }

    const onTouchStart = (e: TouchEvent) => {
      touchStartYRef.current = e.touches[0].clientY
    }

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0].clientY > touchStartYRef.current) detach()
    }

    const onPointerDown = () => {
      pointerDownRef.current = true
    }
    const onPointerUp = () => {
      pointerDownRef.current = false
    }
    const onKeyDown = () => {
      lastUserGestureAtRef.current = performance.now()
    }

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      const threshold = userDetachedRef.current ? REATTACH_THRESHOLD : STICK_THRESHOLD

      // Only a genuine user scroll may detach via a scroll-position delta: an active
      // scrollbar drag (pointer held) or a recent keyboard scroll. A programmatic
      // upward scroll — e.g. a virtualizer re-pinning content on a row-size shrink —
      // has neither and must not be mistaken for the user scrolling away.
      const userDriven =
        pointerDownRef.current ||
        performance.now() - lastUserGestureAtRef.current < USER_GESTURE_WINDOW

      if (distanceFromBottom <= threshold) {
        stickyRef.current = true
        userDetachedRef.current = false
      } else if (
        userDriven &&
        scrollTop < prevScrollTopRef.current &&
        scrollHeight <= prevScrollHeightRef.current
      ) {
        stickyRef.current = false
      }

      prevScrollTopRef.current = scrollTop
      prevScrollHeightRef.current = scrollHeight
    }

    const guardedScroll = () => {
      if (stickyRef.current) scrollToBottom()
    }

    const onMutation = () => {
      prevScrollHeightRef.current = el.scrollHeight
      if (!stickyRef.current) return
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = requestAnimationFrame(guardedScroll)
    }

    // CSS-driven height animations (e.g. Radix Collapsible expanding
    // mid-stream) grow scrollHeight without triggering MutationObserver,
    // so auto-scroll stops following. When any animation starts in the
    // container, follow rAF for a short window so the container stays
    // pinned to the bottom while the animation runs.
    const onAnimationStart = () => {
      if (!stickyRef.current) return
      const until = performance.now() + 500
      const follow = () => {
        if (performance.now() > until || !stickyRef.current) return
        scrollToBottom()
        requestAnimationFrame(follow)
      }
      requestAnimationFrame(follow)
    }

    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('animationstart', onAnimationStart)
    el.addEventListener('pointerdown', onPointerDown, { passive: true })
    el.addEventListener('keydown', onKeyDown, { passive: true })
    window.addEventListener('pointerup', onPointerUp, { passive: true })
    window.addEventListener('pointercancel', onPointerUp, { passive: true })

    const observer = new MutationObserver(onMutation)
    observer.observe(el, { childList: true, subtree: true, characterData: true })

    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('animationstart', onAnimationStart)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      observer.disconnect()
      cancelAnimationFrame(rafIdRef.current)
      // A pointer held through teardown (e.g. dragging the scrollbar as the stream
      // finishes) would never see its window `pointerup`, leaving the ref stuck true
      // into the next session and detaching on the first programmatic re-pin.
      pointerDownRef.current = false
      if (stickyRef.current) scrollToBottom()
    }
  }, [isStreaming, scrollToBottom])

  return { ref: callbackRef, scrollToBottom }
}
