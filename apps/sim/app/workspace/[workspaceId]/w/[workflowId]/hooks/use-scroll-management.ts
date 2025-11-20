'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Custom hook to manage scroll behavior in the copilot panel
 * Handles auto-scrolling during message streaming and user-initiated scrolling
 *
 * @param messages - Array of messages to track for scroll behavior
 * @param isSendingMessage - Whether a message is currently being sent/streamed
 * @returns Scroll management utilities
 */
export function useScrollManagement(messages: any[], isSendingMessage: boolean) {
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [isNearBottom, setIsNearBottom] = useState(true)
  const [userHasScrolledDuringStream, setUserHasScrolledDuringStream] = useState(false)
  const programmaticScrollInProgressRef = useRef(false)
  const lastScrollTopRef = useRef(0)

  /**
   * Scrolls the container to the bottom with smooth animation
   */
  const getScrollContainer = useCallback((): HTMLElement | null => {
    // Prefer the element with the ref (our scrollable div)
    if (scrollAreaRef.current) return scrollAreaRef.current
    return null
  }, [])

  const scrollToBottom = useCallback(() => {
    const scrollContainer = getScrollContainer()
    if (!scrollContainer) return

    programmaticScrollInProgressRef.current = true
    scrollContainer.scrollTo({
      top: scrollContainer.scrollHeight,
      behavior: 'smooth',
    })
    // Best-effort reset; not all browsers fire scrollend reliably
    window.setTimeout(() => {
      programmaticScrollInProgressRef.current = false
    }, 200)
  }, [getScrollContainer])

  /**
   * Handles scroll events to track user position and show/hide scroll button
   */
  const handleScroll = useCallback(() => {
    const scrollContainer = getScrollContainer()
    if (!scrollContainer) return

    if (programmaticScrollInProgressRef.current) {
      // Ignore scrolls we initiated
      return
    }

    const { scrollTop, scrollHeight, clientHeight } = scrollContainer
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight

    const nearBottom = distanceFromBottom <= 100
    setIsNearBottom(nearBottom)

    if (isSendingMessage) {
      const delta = scrollTop - lastScrollTopRef.current
      const movedUp = delta < -2 // small hysteresis to avoid noise
      const movedDown = delta > 2

      if (movedUp) {
        // Any upward movement breaks away from sticky during streaming
        setUserHasScrolledDuringStream(true)
      }

      // If the user has broken away and scrolls back down to the bottom, re-stick
      if (userHasScrolledDuringStream && movedDown && nearBottom) {
        setUserHasScrolledDuringStream(false)
      }
    }

    // Track last scrollTop for direction detection
    lastScrollTopRef.current = scrollTop
  }, [getScrollContainer, isSendingMessage, userHasScrolledDuringStream])

  // Attach scroll listener
  useEffect(() => {
    const scrollContainer = getScrollContainer()
    if (!scrollContainer) return

    const handleUserScroll = () => {
      handleScroll()
    }

    scrollContainer.addEventListener('scroll', handleUserScroll, { passive: true })

    if ('onscrollend' in scrollContainer) {
      scrollContainer.addEventListener('scrollend', handleScroll, { passive: true })
    }

    // Initialize state
    window.setTimeout(handleScroll, 100)
    // Initialize last scroll position
    lastScrollTopRef.current = scrollContainer.scrollTop

    return () => {
      scrollContainer.removeEventListener('scroll', handleUserScroll)
      if ('onscrollend' in scrollContainer) {
        scrollContainer.removeEventListener('scrollend', handleScroll)
      }
    }
  }, [getScrollContainer, handleScroll])

  // Smart auto-scroll: only scroll if user hasn't intentionally scrolled up during streaming
  useEffect(() => {
    if (messages.length === 0) return

    const lastMessage = messages[messages.length - 1]
    const isNewUserMessage = lastMessage?.role === 'user'

    const shouldAutoScroll =
      isNewUserMessage ||
      (isSendingMessage && !userHasScrolledDuringStream) ||
      (!isSendingMessage && isNearBottom)

    if (shouldAutoScroll) {
      scrollToBottom()
    }
  }, [messages, isNearBottom, isSendingMessage, userHasScrolledDuringStream, scrollToBottom])

  // Reset user scroll state when streaming starts or when user sends a message
  useEffect(() => {
    const lastMessage = messages[messages.length - 1]
    if (lastMessage?.role === 'user') {
      setUserHasScrolledDuringStream(false)
      programmaticScrollInProgressRef.current = false
      const scrollContainer = getScrollContainer()
      if (scrollContainer) {
        lastScrollTopRef.current = scrollContainer.scrollTop
      }
    }
  }, [messages, getScrollContainer])

  // Reset user scroll state when streaming completes
  const prevIsSendingRef = useRef(false)
  useEffect(() => {
    if (prevIsSendingRef.current && !isSendingMessage) {
      setUserHasScrolledDuringStream(false)
    }
    prevIsSendingRef.current = isSendingMessage
  }, [isSendingMessage])

  // While streaming and not broken away, keep pinned to bottom
  useEffect(() => {
    if (!isSendingMessage || userHasScrolledDuringStream) return

    const intervalId = window.setInterval(() => {
      const scrollContainer = getScrollContainer()
      if (!scrollContainer) return

      const { scrollTop, scrollHeight, clientHeight } = scrollContainer
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      const nearBottom = distanceFromBottom <= 120
      if (nearBottom) {
        scrollToBottom()
      }
    }, 100)

    return () => window.clearInterval(intervalId)
  }, [isSendingMessage, userHasScrolledDuringStream, getScrollContainer, scrollToBottom])

  return {
    scrollAreaRef,
    scrollToBottom,
  }
}
