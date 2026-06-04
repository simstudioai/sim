import { useCallback, useRef } from 'react'

/** Idle delay before the scrollbar fades back out after scrolling stops. */
const IDLE_MS = 700

/**
 * Reveals a scroll container's scrollbar only while it is actively scrolling.
 *
 * Returns a callback ref to attach to the scroll element. On scroll it sets
 * `data-scrolling="true"` and, after {@link IDLE_MS} of inactivity, clears it to
 * `"false"` — pair with local CSS that hides the thumb unless
 * `data-scrolling="true"`. The attribute is mutated directly (no React state),
 * so scrolling never triggers a re-render. Safe to merge with another ref.
 */
export function useAutoHideScrollbar() {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const cleanupRef = useRef<(() => void) | null>(null)

  return useCallback((el: HTMLElement | null) => {
    cleanupRef.current?.()
    cleanupRef.current = null
    if (!el) return

    const handleScroll = () => {
      el.dataset.scrolling = 'true'
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      timeoutRef.current = setTimeout(() => {
        el.dataset.scrolling = 'false'
      }, IDLE_MS)
    }

    el.addEventListener('scroll', handleScroll, { passive: true })
    cleanupRef.current = () => {
      el.removeEventListener('scroll', handleScroll)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [])
}
