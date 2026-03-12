import { useCallback, useEffect, useRef } from 'react'

const BOTTOM_THRESHOLD = 30

/**
 * Manages sticky auto-scroll for a streaming chat container.
 *
 * Stays pinned to the bottom while content streams in. Detaches when the user
 * scrolls beyond {@link BOTTOM_THRESHOLD} from the bottom. Re-attaches when
 * the scroll position returns within the threshold. Preserves bottom position
 * across container resizes (e.g. sidebar collapse).
 */
export function useAutoScroll(isStreaming: boolean) {
  const containerRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const rafIdRef = useRef(0)
  const teardownRef = useRef<(() => void) | null>(null)

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [])

  const callbackRef = useCallback((el: HTMLDivElement | null) => {
    teardownRef.current?.()
    teardownRef.current = null
    containerRef.current = el
    if (!el) return

    el.scrollTop = el.scrollHeight
    atBottomRef.current = true

    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      atBottomRef.current = scrollHeight - scrollTop - clientHeight <= BOTTOM_THRESHOLD
    }

    const ro = new ResizeObserver(() => {
      if (atBottomRef.current) el.scrollTop = el.scrollHeight
    })

    el.addEventListener('scroll', onScroll, { passive: true })
    ro.observe(el)

    teardownRef.current = () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!isStreaming) return
    const el = containerRef.current
    if (!el) return

    atBottomRef.current = true
    scrollToBottom()

    const guardedScroll = () => {
      if (atBottomRef.current) scrollToBottom()
    }

    const onMutation = () => {
      if (!atBottomRef.current) return
      cancelAnimationFrame(rafIdRef.current)
      rafIdRef.current = requestAnimationFrame(guardedScroll)
    }

    const observer = new MutationObserver(onMutation)
    observer.observe(el, { childList: true, subtree: true, characterData: true })

    return () => {
      observer.disconnect()
      cancelAnimationFrame(rafIdRef.current)
      if (atBottomRef.current) scrollToBottom()
    }
  }, [isStreaming, scrollToBottom])

  return callbackRef
}
