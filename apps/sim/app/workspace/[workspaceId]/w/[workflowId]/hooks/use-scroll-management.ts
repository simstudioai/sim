'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Options for configuring scroll behavior.
 */
interface UseScrollManagementOptions {
  /**
   * Scroll behavior for programmatic scrolls.
   * - `smooth`: animated scroll (default, used by Copilot).
   * - `auto`: immediate scroll to bottom (used by floating chat to avoid jitter).
   */
  behavior?: 'auto' | 'smooth'
  /**
   * Distance from bottom (in pixels) within which auto-scroll stays active.
   * Lower values = less sticky (user can scroll away easier).
   * Default is 100px.
   */
  stickinessThreshold?: number
}

/**
 * Custom hook to manage scroll behavior in scrollable message panels.
 * Handles auto-scrolling during message streaming and user-initiated scrolling.
 *
 * @param messages - Array of messages to track for scroll behavior
 * @param isSendingMessage - Whether a message is currently being sent/streamed
 * @param options - Optional configuration for scroll behavior
 * @returns Scroll management utilities
 */
export function useScrollManagement(
  messages: any[],
  isSendingMessage: boolean,
  options?: UseScrollManagementOptions
) {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [userHasScrolledDuringStream, setUserHasScrolledDuringStream] = useState(false)
  const programmaticScrollInProgressRef = useRef(false)
  const lastScrollTopRef = useRef(0)
  const lastScrollHeightRef = useRef(0)
  const rafIdRef = useRef<number | null>(null)
  const scrollBehavior: 'auto' | 'smooth' = options?.behavior ?? 'smooth'
  const stickinessThreshold = options?.stickinessThreshold ?? 100

  const getScrollContainer = useCallback((): HTMLElement | null => {
    if (scrollAreaRef.current) return scrollAreaRef.current
    return null
  }, [])

  /**
   * Scrolls the container to the bottom
   * Uses 'auto' for streaming to prevent jitter, 'smooth' for user actions
   */
  const scrollToBottom = useCallback(
    (forceInstant = false) => {
      const scrollContainer = getScrollContainer()
      if (!scrollContainer) return

      programmaticScrollInProgressRef.current = true
      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: forceInstant ? 'auto' : scrollBehavior,
      })
      // Reset flag after scroll completes
      window.setTimeout(
        () => {
          programmaticScrollInProgressRef.current = false
        },
        forceInstant ? 16 : 200
      )
    },
    [getScrollContainer, scrollBehavior]
  )

  /**
   * Handles scroll events to track user position
   */
  const handleScroll = useCallback(() => {
    const scrollContainer = getScrollContainer()
    if (!scrollContainer) return

    if (programmaticScrollInProgressRef.current) {
      return
    }

    const { scrollTop, scrollHeight, clientHeight } = scrollContainer
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight

    const nearBottom = distanceFromBottom <= stickinessThreshold
    setIsNearBottom(nearBottom)

    if (isSendingMessage) {
      const delta = scrollTop - lastScrollTopRef.current
      const movedUp = delta < -2

      if (movedUp) {
        setUserHasScrolledDuringStream(true)
      }

      // Re-stick if user scrolls back to bottom
      if (userHasScrolledDuringStream && nearBottom && delta > 2) {
        setUserHasScrolledDuringStream(false)
      }
    }

    lastScrollTopRef.current = scrollTop
  }, [getScrollContainer, isSendingMessage, userHasScrolledDuringStream, stickinessThreshold])

  // Attach scroll listener
  useEffect(() => {
    const scrollContainer = getScrollContainer()
    if (!scrollContainer) return

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    lastScrollTopRef.current = scrollContainer.scrollTop
    lastScrollHeightRef.current = scrollContainer.scrollHeight

    return () => {
      scrollContainer.removeEventListener('scroll', handleScroll)
    }
  }, [getScrollContainer, handleScroll])

  // Scroll on new user message
  useEffect(() => {
    if (messages.length === 0) return

    const lastMessage = messages[messages.length - 1]
    if (lastMessage?.role === 'user') {
      setUserHasScrolledDuringStream(false)
      scrollToBottom()
    }
  }, [messages, scrollToBottom])

  // Reset user scroll state when streaming completes
  const prevIsSendingRef = useRef(false)
  useEffect(() => {
    if (prevIsSendingRef.current && !isSendingMessage) {
      setUserHasScrolledDuringStream(false)
      // Final scroll to ensure we're at bottom
      if (isNearBottom) {
        scrollToBottom()
      }
    }
    prevIsSendingRef.current = isSendingMessage
  }, [isSendingMessage, isNearBottom, scrollToBottom])

  // While streaming, use RAF to check for content changes and scroll
  // This is more efficient than setInterval and syncs with browser rendering
  useEffect(() => {
    if (!isSendingMessage || userHasScrolledDuringStream) {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      return
    }

    const checkAndScroll = () => {
      const scrollContainer = getScrollContainer()
      if (!scrollContainer) {
        rafIdRef.current = requestAnimationFrame(checkAndScroll)
        return
      }

      const { scrollHeight } = scrollContainer
      // Only scroll if content height actually changed
      if (scrollHeight !== lastScrollHeightRef.current) {
        lastScrollHeightRef.current = scrollHeight
        // Use instant scroll during streaming to prevent jitter
        scrollToBottom(true)
      }

      rafIdRef.current = requestAnimationFrame(checkAndScroll)
    }

    rafIdRef.current = requestAnimationFrame(checkAndScroll)

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [isSendingMessage, userHasScrolledDuringStream, getScrollContainer, scrollToBottom])

  return {
    scrollAreaRef,
    scrollToBottom: () => scrollToBottom(false),
  }
}
