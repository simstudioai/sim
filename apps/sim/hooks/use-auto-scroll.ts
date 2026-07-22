import { useCallback, useEffect, useRef } from 'react'
import { createSmoothBottomChase } from '@/lib/core/utils/smooth-bottom-chase'

/** Tolerance for keeping stickiness during programmatic auto-scroll. */
const STICK_THRESHOLD = 30
/** User must scroll back to within this distance to re-engage auto-scroll. */
const REATTACH_THRESHOLD = 5
/**
 * An upward keyboard scroll ({@link SCROLL_UP_KEYS}) only emits `scroll` events, so
 * its detach is honored when it lands within this window of the `keydown`. Wheel and
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
/**
 * Keys that scroll the viewport upward. Only these authorize a keyboard detach,
 * mirroring the wheel handler's upward-only ({@link WheelEvent.deltaY} < 0) rule,
 * so an unrelated keypress can't open the detach window. `Shift`+`Space` (handled
 * in the listener) is the other upward shortcut; plain `Space` pages down.
 */
const SCROLL_UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home'])
/**
 * Manages sticky auto-scroll for a streaming chat container.
 *
 * Stays pinned to the bottom while content streams in. Detaches immediately
 * on any upward user gesture (wheel, touch, scrollbar drag, keyboard). Once
 * detached, the user must scroll back down to within {@link REATTACH_THRESHOLD}
 * of the bottom to re-engage. Each streaming start re-seeds stickiness from the
 * current scroll position, so a user who scrolled up beforehand stays put.
 *
 * Returns `ref` (callback ref for the scroll container) and `detach` for
 * programmatic freezes (a user stop) — it parks every chase path exactly like
 * a user scroll-away, until the user scrolls back to the bottom or the next
 * stream re-seeds stickiness.
 */
export function useAutoScroll(isStreaming: boolean) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)
  const userDetachedRef = useRef(false)
  const prevScrollTopRef = useRef(0)
  const prevScrollHeightRef = useRef(0)
  const touchStartYRef = useRef(0)
  /**
   * Whether the user is actively dragging the scrollbar — a pointer press on the
   * container itself rather than its content. Reset on teardown so a pointer held
   * as one stream ends can't leak into the next session and authorize a detach.
   */
  const pointerDownRef = useRef(false)
  /**
   * Timestamp of the last keyboard scroll, the only detach gesture that emits no
   * wheel/touch/pointer signal. Gates {@link USER_GESTURE_WINDOW}; reset on teardown
   * so a keypress near a stream's end can't carry into the next session.
   */
  const lastUserGestureAtRef = useRef(Number.NEGATIVE_INFINITY)

  const detach = useCallback(() => {
    stickyRef.current = false
    userDetachedRef.current = true
  }, [])

  const callbackRef = useCallback((el: HTMLDivElement | null) => {
    containerRef.current = el
  }, [])

  useEffect(() => {
    if (!isStreaming) return
    const el = containerRef.current
    if (!el) return

    /**
     * Eased bottom-chase shared by the mutation observer and the seed below —
     * the same glide the subagent viewport uses, instead of snapping to
     * `scrollHeight` on every content mutation. Chase writes only ever move
     * `scrollTop` down, so the detach logic in `onScroll` (which requires an
     * upward move) never mistakes the glide for a user scroll; the helper's
     * own upward-move interrupt and the per-frame sticky check are extra
     * layers of the same guarantee.
     */
    const chase = createSmoothBottomChase(
      {
        getTop: () => el.scrollTop,
        getBottomTop: () => el.scrollHeight - el.clientHeight,
        setTop: (top) => {
          el.scrollTop = top
        },
      },
      () => stickyRef.current
    )

    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    const isNearBottom = distanceFromBottom <= STICK_THRESHOLD
    stickyRef.current = isNearBottom
    userDetachedRef.current = !isNearBottom
    prevScrollTopRef.current = el.scrollTop
    prevScrollHeightRef.current = el.scrollHeight
    if (isNearBottom) chase.kick()

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

    /**
     * A scrollbar press targets the scroll container itself; a press on message
     * content targets a descendant. Only the former is a scroll gesture, so a
     * text-selection drag on content can't authorize a detach.
     */
    const onPointerDown = (e: PointerEvent) => {
      if (e.target === el) pointerDownRef.current = true
    }
    const onPointerUp = () => {
      pointerDownRef.current = false
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (SCROLL_UP_KEYS.has(e.key) || (e.key === ' ' && e.shiftKey)) {
        lastUserGestureAtRef.current = performance.now()
      }
    }

    /**
     * Re-engages when the user returns near the bottom, and detaches on an upward
     * scroll — but only a genuine user scroll qualifies: an active scrollbar drag
     * (pointer held) or a recent keyboard scroll. A programmatic upward scroll, e.g.
     * a virtualizer re-pinning content on a row-size shrink, has neither and must not
     * be mistaken for the user scrolling away.
     *
     * Re-attach also requires a downward move once detached — a small upward
     * flick still lands within {@link REATTACH_THRESHOLD}, and would otherwise
     * re-stick on its own scroll event.
     */
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      const threshold = userDetachedRef.current ? REATTACH_THRESHOLD : STICK_THRESHOLD
      const userDriven =
        pointerDownRef.current ||
        performance.now() - lastUserGestureAtRef.current < USER_GESTURE_WINDOW
      const movedDown = scrollTop > prevScrollTopRef.current

      if (distanceFromBottom <= threshold && (!userDetachedRef.current || movedDown)) {
        stickyRef.current = true
        userDetachedRef.current = false
      } else if (
        userDriven &&
        scrollTop < prevScrollTopRef.current &&
        scrollHeight <= prevScrollHeightRef.current
      ) {
        detach()
      }

      prevScrollTopRef.current = scrollTop
      prevScrollHeightRef.current = scrollHeight
    }

    /**
     * The single growth signal: the transcript sizer's height. Every source of
     * scrollHeight growth flows through it — virtualizer re-measures per
     * streamed token, CSS height animations (each frame re-measures the row),
     * the sizer min-height floor — so one ResizeObserver replaces a subtree
     * MutationObserver plus an `animationstart` deadline machine, and there is
     * exactly one reason the chase ever runs.
     */
    const sizer = el.firstElementChild
    const onSizerResize = () => {
      prevScrollHeightRef.current = el.scrollHeight
      if (!stickyRef.current) return
      chase.kick()
    }

    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('pointerdown', onPointerDown, { passive: true })
    el.addEventListener('keydown', onKeyDown, { passive: true })
    window.addEventListener('pointerup', onPointerUp, { passive: true })
    window.addEventListener('pointercancel', onPointerUp, { passive: true })

    const observer = new ResizeObserver(onSizerResize)
    if (sizer) observer.observe(sizer)

    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      observer.disconnect()
      chase.cancel()
      pointerDownRef.current = false
      lastUserGestureAtRef.current = Number.NEGATIVE_INFINITY
      // Teardown can land mid-glide (options mounted late in the reveal, gap
      // not yet closed) — canceling there strands the follow-ups behind the
      // input. One plain kick runs the loop to rest and parks; a stopped turn
      // stays frozen because the detached sticky check parks it on frame one.
      chase.kick()
    }
  }, [isStreaming])

  return { ref: callbackRef, detach }
}
