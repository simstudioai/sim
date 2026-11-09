'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const AUTO_SCROLL_GRACE_MS = 120

function distanceFromBottom(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

interface UseScrollManagementOptions {
  /**
   * Scroll behavior for programmatic scrolls.
   * - `smooth`: Animated scroll (default, used by Copilot)
   * - `auto`: Immediate scroll to bottom (used by floating chat to avoid jitter)
   */
  behavior?: 'auto' | 'smooth'
  /**
   * Distance from bottom (in pixels) within which auto-scroll stays active.
   * @defaultValue 30
   */
  stickinessThreshold?: number
}

/**
 * Manages auto-scrolling during message streaming using ResizeObserver
 * instead of a polling interval.
 *
 * Tracks whether scrolls are programmatic (via a timestamp grace window)
 * to avoid falsely treating our own scrolls as the user scrolling away.
 * Handles nested scrollable regions marked with `data-scrollable` so that
 * scrolling inside tool output or code blocks doesn't break follow-mode.
 */
export function useScrollManagement(
  messages: any[],
  isSendingMessage: boolean,
  options?: UseScrollManagementOptions
) {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [userHasScrolledAway, setUserHasScrolledAway] = useState(false)
  const [prevIsSendingMessage, setPrevIsSendingMessage] = useState(isSendingMessage)
  if (prevIsSendingMessage !== isSendingMessage) {
    setPrevIsSendingMessage(isSendingMessage)
    if (!isSendingMessage) {
      setUserHasScrolledAway(false)
    }
  }
  const programmaticUntilRef = useRef(0)
  const lastScrollTopRef = useRef(0)

  const scrollBehavior = options?.behavior ?? 'smooth'
  const stickinessThreshold = options?.stickinessThreshold ?? 30

  const isSendingRef = useRef(isSendingMessage)
  isSendingRef.current = isSendingMessage
  const userScrolledRef = useRef(userHasScrolledAway)
  userScrolledRef.current = userHasScrolledAway

  const markProgrammatic = useCallback(() => {
    programmaticUntilRef.current = Date.now() + AUTO_SCROLL_GRACE_MS
  }, [])

  const isProgrammatic = useCallback(() => {
    return Date.now() < programmaticUntilRef.current
  }, [])

  const scrollToBottom = useCallback(() => {
    const container = scrollAreaRef.current
    if (!container) return

    markProgrammatic()
    container.scrollTo({ top: container.scrollHeight, behavior: scrollBehavior })
  }, [scrollBehavior, markProgrammatic])

  useEffect(() => {
    const container = scrollAreaRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      const dist = scrollHeight - scrollTop - clientHeight

      if (isProgrammatic()) {
        lastScrollTopRef.current = scrollTop
        if (dist < stickinessThreshold && userScrolledRef.current) {
          setUserHasScrolledAway(false)
        }
        return
      }

      const nearBottom = dist <= stickinessThreshold
      const delta = scrollTop - lastScrollTopRef.current

      if (isSendingRef.current) {
        if (delta < -2 && !userScrolledRef.current) {
          setUserHasScrolledAway(true)
        }
        if (userScrolledRef.current && delta > 2 && nearBottom) {
          setUserHasScrolledAway(false)
        }
      }

      lastScrollTopRef.current = scrollTop
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    lastScrollTopRef.current = container.scrollTop

    return () => container.removeEventListener('scroll', handleScroll)
  }, [stickinessThreshold, isProgrammatic])

  // Ignore upward wheel events inside nested [data-scrollable] regions
  // (tool output, code blocks) so they don't break follow-mode.
  useEffect(() => {
    const container = scrollAreaRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY >= 0) return

      const target = e.target instanceof Element ? e.target : undefined
      const nested = target?.closest('[data-scrollable]')
      if (nested && nested !== container) return

      if (!userScrolledRef.current && isSendingRef.current) {
        setUserHasScrolledAway(true)
      }
    }

    container.addEventListener('wheel', handleWheel, { passive: true })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [])

  useEffect(() => {
    if (messages.length === 0) return

    const lastMessage = messages[messages.length - 1]
    const isUserMessage = lastMessage?.role === 'user'

    if (isUserMessage) {
      setUserHasScrolledAway(false)
      scrollToBottom()
    } else if (!userHasScrolledAway) {
      scrollToBottom()
    }
  }, [messages, userHasScrolledAway, scrollToBottom])

  useEffect(() => {
    if (!isSendingMessage || userHasScrolledAway) return

    const container = scrollAreaRef.current
    if (!container) return

    const content = container.firstElementChild as HTMLElement | null
    if (!content) return

    const observer = new ResizeObserver(() => {
      if (distanceFromBottom(container) > 1) {
        scrollToBottom()
      }
    })

    observer.observe(content)

    return () => observer.disconnect()
  }, [isSendingMessage, userHasScrolledAway, scrollToBottom])

  // overflow-anchor: none during streaming prevents the browser from
  // fighting our programmatic scrollToBottom calls (Chromium/Firefox only;
  // Safari does not support this property).
  useLayoutEffect(() => {
    const container = scrollAreaRef.current
    if (!container) return

    container.style.overflowAnchor = isSendingMessage && !userHasScrolledAway ? 'none' : 'auto'
  }, [isSendingMessage, userHasScrolledAway])

  return {
    scrollAreaRef,
    scrollToBottom,
  }
}
