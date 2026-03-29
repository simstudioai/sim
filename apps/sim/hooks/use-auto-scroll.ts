import { useCallback, useEffect, useRef } from 'react'

/** Tolerance for keeping stickiness during programmatic auto-scroll. */
const STICK_THRESHOLD = 30
/** User must scroll back to within this distance to re-engage auto-scroll. */
const REATTACH_THRESHOLD = 5

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

    stickyRef.current = true
    userDetachedRef.current = false
    prevScrollTopRef.current = el.scrollTop
    prevScrollHeightRef.current = el.scrollHeight
    scrollToBottom()

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

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      const threshold = userDetachedRef.current ? REATTACH_THRESHOLD : STICK_THRESHOLD

      if (distanceFromBottom <= threshold) {
        stickyRef.current = true
        userDetachedRef.current = false
      } else if (
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

    el.addEventListener('wheel', onWheel, { passive: true })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: true })
    el.addEventListener('scroll', onScroll, { passive: true })

    const observer = new MutationObserver(onMutation)
    observer.observe(el, { childList: true, subtree: true, characterData: true })

    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('scroll', onScroll)
      observer.disconnect()
      cancelAnimationFrame(rafIdRef.current)
      if (stickyRef.current) scrollToBottom()
    }
  }, [isStreaming, scrollToBottom])

  return { ref: callbackRef, scrollToBottom }
}
