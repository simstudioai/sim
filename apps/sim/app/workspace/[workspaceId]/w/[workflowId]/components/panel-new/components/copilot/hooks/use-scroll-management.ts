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
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [userHasScrolledDuringStream, setUserHasScrolledDuringStream] = useState(false)
  const isUserScrollingRef = useRef(false)

  /**
   * Scrolls the container to the bottom with smooth animation
   */
  const scrollToBottom = useCallback(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        '[data-radix-scroll-area-viewport]'
      )
      if (scrollContainer) {
        isUserScrollingRef.current = false
        scrollContainer.scrollTo({
          top: scrollContainer.scrollHeight,
          behavior: 'smooth',
        })
      }
    }
  }, [])

  /**
   * Handles scroll events to track user position and show/hide scroll button
   */
  const handleScroll = useCallback(() => {
    const scrollArea = scrollAreaRef.current
    if (!scrollArea) return

    const viewport = scrollArea.querySelector('[data-radix-scroll-area-viewport]')
    if (!viewport) return

    const { scrollTop, scrollHeight, clientHeight } = viewport
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight

    const nearBottom = distanceFromBottom <= 100
    setIsNearBottom(nearBottom)
    setShowScrollButton(!nearBottom)

    if (isSendingMessage && !nearBottom && isUserScrollingRef.current) {
      setUserHasScrolledDuringStream(true)
    }

    isUserScrollingRef.current = true
  }, [isSendingMessage])

  // Attach scroll listener
  useEffect(() => {
    const scrollArea = scrollAreaRef.current
    if (!scrollArea) return

    const viewport = scrollArea.querySelector('[data-radix-scroll-area-viewport]')
    if (!viewport) return

    const handleUserScroll = () => {
      isUserScrollingRef.current = true
      handleScroll()
    }

    viewport.addEventListener('scroll', handleUserScroll, { passive: true })

    if ('onscrollend' in viewport) {
      viewport.addEventListener('scrollend', handleScroll, { passive: true })
    }

    setTimeout(handleScroll, 100)

    return () => {
      viewport.removeEventListener('scroll', handleUserScroll)
      if ('onscrollend' in viewport) {
        viewport.removeEventListener('scrollend', handleScroll)
      }
    }
  }, [handleScroll])

  // Smart auto-scroll: only scroll if user hasn't intentionally scrolled up during streaming
  useEffect(() => {
    if (messages.length === 0) return

    const lastMessage = messages[messages.length - 1]
    const isNewUserMessage = lastMessage?.role === 'user'

    const shouldAutoScroll =
      isNewUserMessage ||
      (isSendingMessage && !userHasScrolledDuringStream) ||
      (!isSendingMessage && isNearBottom)

    if (shouldAutoScroll && scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        '[data-radix-scroll-area-viewport]'
      )
      if (scrollContainer) {
        isUserScrollingRef.current = false
        scrollContainer.scrollTo({
          top: scrollContainer.scrollHeight,
          behavior: 'smooth',
        })
      }
    }
  }, [messages, isNearBottom, isSendingMessage, userHasScrolledDuringStream])

  // Reset user scroll state when streaming starts or when user sends a message
  useEffect(() => {
    const lastMessage = messages[messages.length - 1]
    if (lastMessage?.role === 'user') {
      setUserHasScrolledDuringStream(false)
      isUserScrollingRef.current = false
    }
  }, [messages])

  // Reset user scroll state when streaming completes
  const prevIsSendingRef = useRef(false)
  useEffect(() => {
    if (prevIsSendingRef.current && !isSendingMessage) {
      setUserHasScrolledDuringStream(false)
    }
    prevIsSendingRef.current = isSendingMessage
  }, [isSendingMessage])

  return {
    scrollAreaRef,
    showScrollButton,
    scrollToBottom,
  }
}
