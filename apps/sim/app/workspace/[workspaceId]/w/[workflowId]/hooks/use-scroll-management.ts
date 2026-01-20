'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Options for configuring scroll behavior
 */
interface UseScrollManagementOptions {
  /**
   * Scroll behavior for programmatic scrolls
   * @remarks
   * - `smooth`: Animated scroll (default, used by Copilot)
   * - `auto`: Immediate scroll to bottom (used by floating chat to avoid jitter)
   */
  behavior?: 'auto' | 'smooth'
  /**
   * Distance from bottom (in pixels) within which auto-scroll stays active
   * @remarks Lower values = less sticky (user can scroll away easier)
   * @defaultValue 100
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
  const [userHasScrolledAway, setUserHasScrolledAway] = useState(false)
  const programmaticScrollRef = useRef(false)
  const lastScrollTopRef = useRef(0)

  const scrollBehavior = options?.behavior ?? 'smooth'
  const stickinessThreshold = options?.stickinessThreshold ?? 100

  /** Scrolls the container to the bottom */
  const scrollToBottom = useCallback(() => {
    const container = scrollAreaRef.current
    if (!container) return

    programmaticScrollRef.current = true
    container.scrollTo({ top: container.scrollHeight, behavior: scrollBehavior })

    window.setTimeout(() => {
      programmaticScrollRef.current = false
    }, 200)
  }, [scrollBehavior])

  /** Handles scroll events to track user position */
  const handleScroll = useCallback(() => {
    const container = scrollAreaRef.current
    if (!container || programmaticScrollRef.current) return

    const { scrollTop, scrollHeight, clientHeight } = container
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight
    const nearBottom = distanceFromBottom <= stickinessThreshold
    const delta = scrollTop - lastScrollTopRef.current

    if (isSendingMessage) {
      // User scrolled up during streaming - break away
      if (delta < -2) {
        setUserHasScrolledAway(true)
      }
      // User scrolled back down to bottom - re-stick
      if (userHasScrolledAway && delta > 2 && nearBottom) {
        setUserHasScrolledAway(false)
      }
    }

    lastScrollTopRef.current = scrollTop
  }, [isSendingMessage, userHasScrolledAway, stickinessThreshold])

  /** Attaches scroll listener to container */
  useEffect(() => {
    const container = scrollAreaRef.current
    if (!container) return

    container.addEventListener('scroll', handleScroll, { passive: true })
    lastScrollTopRef.current = container.scrollTop

    return () => container.removeEventListener('scroll', handleScroll)
  }, [handleScroll])

  /** Handles auto-scroll when new messages are added */
  useEffect(() => {
    if (messages.length === 0) return

    const lastMessage = messages[messages.length - 1]
    const isUserMessage = lastMessage?.role === 'user'

    // Always scroll for user messages, respect scroll state for assistant messages
    if (isUserMessage) {
      setUserHasScrolledAway(false)
      scrollToBottom()
    } else if (!userHasScrolledAway) {
      scrollToBottom()
    }
  }, [messages, userHasScrolledAway, scrollToBottom])

  /** Resets scroll state when streaming completes */
  useEffect(() => {
    if (!isSendingMessage) {
      setUserHasScrolledAway(false)
    }
  }, [isSendingMessage])

  /** Keeps scroll pinned during streaming - uses interval, stops when user scrolls away */
  useEffect(() => {
    // Early return stops the interval when user scrolls away (state change re-runs effect)
    if (!isSendingMessage || userHasScrolledAway) {
      return
    }

    const intervalId = window.setInterval(() => {
      const container = scrollAreaRef.current
      if (!container) return

      const { scrollTop, scrollHeight, clientHeight } = container
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight

      if (distanceFromBottom > 1) {
        scrollToBottom()
      }
    }, 100)

    return () => window.clearInterval(intervalId)
  }, [isSendingMessage, userHasScrolledAway, scrollToBottom])

  return {
    scrollAreaRef,
    scrollToBottom,
  }
}
