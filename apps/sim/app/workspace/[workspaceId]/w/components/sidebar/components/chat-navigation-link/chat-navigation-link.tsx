'use client'

import {
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { mothershipChatHistoryQueryOptions } from '@/hooks/queries/mothership-chats'

const CHAT_PREFETCH_DWELL_MS = 80

function isUnmodifiedPrimaryPointer(event: ReactPointerEvent<HTMLAnchorElement>) {
  const nestedAction =
    event.target instanceof Element && event.target.closest('button, [role="button"]') !== null

  return (
    !event.defaultPrevented &&
    !nestedAction &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}

interface ChatNavigationLinkProps extends Omit<ComponentProps<typeof Link>, 'href' | 'prefetch'> {
  chatId: string
  href: string
  isCurrentRoute?: boolean
}

export function ChatNavigationLink(props: ChatNavigationLinkProps) {
  const routeRole = props.isCurrentRoute ? 'current' : 'destination'
  return <IntentAwareChatNavigationLink key={`${props.chatId}:${routeRole}`} {...props} />
}

function IntentAwareChatNavigationLink({
  chatId,
  href,
  isCurrentRoute = false,
  onBlur,
  onClick,
  onFocus,
  onMouseEnter,
  onMouseLeave,
  onPointerCancel,
  onPointerDown,
  onPointerUp,
  onTouchStart,
  ...props
}: ChatNavigationLinkProps) {
  const queryClient = useQueryClient()
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navigationIntentRef = useRef(false)
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
    navigationIntentRef.current = true
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
        navigationIntentRef.current = false
        setShouldPrefetchRoute(false)
      }}
      onFocus={(event) => {
        onFocus?.(event)
        if (!event.defaultPrevented) prefetchForIntent()
      }}
      onBlur={(event) => {
        onBlur?.(event)
        cancelScheduledPrefetch()
        navigationIntentRef.current = false
        setShouldPrefetchRoute(false)
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        if (event.pointerType === 'mouse' && isUnmodifiedPrimaryPointer(event)) {
          prefetchForIntent()
        }
      }}
      onPointerUp={(event) => {
        onPointerUp?.(event)
        if (event.pointerType !== 'mouse' && isUnmodifiedPrimaryPointer(event)) {
          prefetchForIntent()
        }
      }}
      onPointerCancel={(event) => {
        onPointerCancel?.(event)
        cancelScheduledPrefetch()
        navigationIntentRef.current = false
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
          if (!isCurrentRoute && !navigationIntentRef.current) prefetchHistory()
        }
      }}
    />
  )
}
