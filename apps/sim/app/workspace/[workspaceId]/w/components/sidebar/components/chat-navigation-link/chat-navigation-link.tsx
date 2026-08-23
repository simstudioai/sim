'use client'

import { type ComponentProps, useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { mothershipChatHistoryQueryOptions } from '@/hooks/queries/mothership-chats'

const CHAT_PREFETCH_DWELL_MS = 80

interface ChatNavigationLinkProps extends Omit<ComponentProps<typeof Link>, 'href' | 'prefetch'> {
  chatId: string
  href: string
  isCurrentRoute?: boolean
}

export function ChatNavigationLink({
  chatId,
  href,
  isCurrentRoute = false,
  onBlur,
  onClick,
  onFocus,
  onMouseEnter,
  onMouseLeave,
  onTouchStart,
  ...props
}: ChatNavigationLinkProps) {
  const queryClient = useQueryClient()
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [shouldPrefetchRoute, setShouldPrefetchRoute] = useState(false)

  const cancelScheduledPrefetch = useCallback(() => {
    if (prefetchTimerRef.current === null) return
    clearTimeout(prefetchTimerRef.current)
    prefetchTimerRef.current = null
  }, [])

  const prefetchHistory = () => {
    if (chatId !== 'new') {
      void queryClient.prefetchQuery(mothershipChatHistoryQueryOptions(chatId))
    }
  }

  const prefetchForIntent = () => {
    cancelScheduledPrefetch()
    if (isCurrentRoute) return
    setShouldPrefetchRoute(true)
    prefetchHistory()
  }

  const schedulePrefetch = () => {
    cancelScheduledPrefetch()
    prefetchTimerRef.current = setTimeout(() => {
      prefetchTimerRef.current = null
      prefetchForIntent()
    }, CHAT_PREFETCH_DWELL_MS)
  }

  useEffect(() => cancelScheduledPrefetch, [cancelScheduledPrefetch])

  return (
    <Link
      {...props}
      href={href}
      prefetch={!isCurrentRoute && shouldPrefetchRoute}
      onMouseEnter={(event) => {
        onMouseEnter?.(event)
        if (!event.defaultPrevented) schedulePrefetch()
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event)
        cancelScheduledPrefetch()
        setShouldPrefetchRoute(false)
      }}
      onFocus={(event) => {
        onFocus?.(event)
        if (!event.defaultPrevented) prefetchForIntent()
      }}
      onBlur={(event) => {
        onBlur?.(event)
        cancelScheduledPrefetch()
        setShouldPrefetchRoute(false)
      }}
      onTouchStart={onTouchStart}
      onClick={(event) => {
        onClick?.(event)
        if (
          !event.defaultPrevented &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey
        ) {
          cancelScheduledPrefetch()
          if (!isCurrentRoute && !shouldPrefetchRoute) prefetchHistory()
          setShouldPrefetchRoute(false)
        }
      }}
    />
  )
}
