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
/** How long to keep chasing the bottom while a CSS height animation plays. */
const ANIMATION_FOLLOW_WINDOW = 500
/**
 * How long to keep chasing the bottom after streaming stops. End-of-turn content
 * mounts just after `isStreaming` flips false — the suggested-follow-up options,
 * the actions row (swapped into the thinking slot's place), and the
 * virtualizer's re-measure of the grown row — so a single final scroll fires
 * before it lays out and leaves it clipped behind the input. Following for a
 * short window pulls it into view.
 */
const POST_STREAM_SETTLE_WINDOW = 300

interface UseAutoScrollOptions {
  scrollOnMount?: boolean
  /**
   * Consulted at stream teardown; return false to skip the post-stream settle
   * follow. A user-initiated stop means "freeze" — chasing the stopped-row and
   * actions mount would visibly nudge the transcript the user just halted.
   */
  shouldFollowSettle?: () => boolean
}

/**
 * Manages sticky auto-scroll for a streaming chat container.
 *
 * Stays pinned to the bottom while content streams in. Detaches immediately
 * on any upward user gesture (wheel, touch, scrollbar drag, keyboard). Once
 * detached, the user must scroll back down to within {@link REATTACH_THRESHOLD}
 * of the bottom to re-engage. Each streaming start re-seeds stickiness from the
 * current scroll position, so a user who scrolled up beforehand stays put.
 *
 * Returns `ref` (callback ref for the scroll container) and `scrollToBottom`
 * for imperative use after layout-changing events like panel expansion.
 */
export function useAutoScroll(
  isStreaming: boolean,
  { scrollOnMount = false, shouldFollowSettle }: UseAutoScrollOptions = {}
) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef(true)
  const shouldFollowSettleRef = useRef(shouldFollowSettle)
  shouldFollowSettleRef.current = shouldFollowSettle
  const userDetachedRef = useRef(false)
  const prevScrollTopRef = useRef(0)
  const prevScrollHeightRef = useRef(0)
  const touchStartYRef = useRef(0)
  const scrollOnMountRef = useRef(scrollOnMount)
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

    const onMutation = () => {
      prevScrollHeightRef.current = el.scrollHeight
      if (!stickyRef.current) return
      chase.kick()
    }

    /**
     * CSS-driven height animations (e.g. Radix Collapsible expanding mid-stream)
     * grow scrollHeight without triggering MutationObserver, so auto-scroll stops
     * following. Keep the one chase loop alive for a short window so the
     * container stays pinned while the animation runs. `animationstart` fires
     * for every child animation in the transcript (segment fade-ins, loader
     * keyframes, label crossfades) — kickUntil coalesces them into a single
     * extended deadline on the single loop; anything more snaps the glide.
     */
    const onAnimationStart = () => chase.kickUntil(ANIMATION_FOLLOW_WINDOW)

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
      chase.cancel()
      pointerDownRef.current = false
      lastUserGestureAtRef.current = Number.NEGATIVE_INFINITY
      // End-of-turn content mounts just after teardown; follow it briefly. The
      // chase's own upward-move interrupt still protects a real user scroll
      // even with the gesture listeners gone.
      if (shouldFollowSettleRef.current?.() !== false) {
        chase.kickUntil(POST_STREAM_SETTLE_WINDOW)
      }
    }
  }, [isStreaming, scrollToBottom])

  return { ref: callbackRef, scrollToBottom }
}
