'use client'

import { useCallback, useEffect, useRef } from 'react'

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
  const userHasScrolledRef = useRef(false)
  const programmaticScrollRef = useRef(false)
  const lastScrollTopRef = useRef(0)
  const lastMessageCountRef = useRef(0)
  const rafIdRef = useRef<number | null>(null)

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

    if (delta < -2) {
      userHasScrolledRef.current = true
    } else if (userHasScrolledRef.current && delta > 2 && nearBottom) {
      userHasScrolledRef.current = false
    }

    lastScrollTopRef.current = scrollTop
  }, [stickinessThreshold])

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

    const messageAdded = messages.length > lastMessageCountRef.current
    lastMessageCountRef.current = messages.length

    if (messageAdded) {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage?.role === 'user') {
        userHasScrolledRef.current = false
      }
      scrollToBottom()
    }
  }, [messages, scrollToBottom])

  /** Resets scroll state when streaming completes */
  const prevIsSendingRef = useRef(false)
  useEffect(() => {
    if (prevIsSendingRef.current && !isSendingMessage) {
      userHasScrolledRef.current = false
    }
    prevIsSendingRef.current = isSendingMessage
  }, [isSendingMessage])

  /** Keeps scroll pinned during streaming using requestAnimationFrame */
  useEffect(() => {
    if (!isSendingMessage || userHasScrolledRef.current) {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      return
    }

    const tick = () => {
      const container = scrollAreaRef.current
      if (container && !userHasScrolledRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = container
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight
        if (distanceFromBottom <= stickinessThreshold) {
          scrollToBottom()
        }
      }
      rafIdRef.current = requestAnimationFrame(tick)
    }

    rafIdRef.current = requestAnimationFrame(tick)

    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [isSendingMessage, scrollToBottom, stickinessThreshold])

  return {
    scrollAreaRef,
    scrollToBottom,
  }
}
