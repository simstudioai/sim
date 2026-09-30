'use client'

import {
  type ComponentProps,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const SETTINGS_PREFETCH_DWELL_MS = 80

interface SettingsIntentLinkProps extends Omit<ComponentProps<typeof Link>, 'prefetch'> {
  /** Runs when deliberate interaction signals likely navigation. */
  onIntent?: () => void
}

function hrefPathname(href: ComponentProps<typeof Link>['href']): string | null {
  if (typeof href === 'string') return href.split(/[?#]/, 1)[0] || null
  return typeof href.pathname === 'string' ? href.pathname : null
}

function isUnmodifiedPrimaryPointer(event: ReactPointerEvent<HTMLAnchorElement>): boolean {
  return (
    !event.defaultPrevented &&
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  )
}

export function SettingsIntentLink(props: SettingsIntentLinkProps) {
  const pathname = usePathname()
  const destinationPathname = hrefPathname(props.href)
  const isCurrentRoute =
    destinationPathname !== null &&
    pathname !== null &&
    (destinationPathname === pathname || pathname.startsWith(`${destinationPathname}/`))
  const routeRole = isCurrentRoute ? 'current' : 'destination'

  return (
    <IntentAwareSettingsLink
      key={`${destinationPathname ?? 'unknown'}:${routeRole}`}
      {...props}
      isCurrentRoute={isCurrentRoute}
    />
  )
}

interface IntentAwareSettingsLinkProps extends SettingsIntentLinkProps {
  isCurrentRoute: boolean
}

function IntentAwareSettingsLink({
  isCurrentRoute,
  onBlur,
  onClick,
  onFocus,
  onIntent,
  onMouseEnter,
  onMouseLeave,
  onPointerCancel,
  onPointerDown,
  onPointerUp,
  onTouchStart,
  ...props
}: IntentAwareSettingsLinkProps) {
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const navigationIntentRef = useRef(false)
  const [shouldPrefetchRoute, setShouldPrefetchRoute] = useState(false)

  const cancelScheduledPrefetch = useCallback(() => {
    if (prefetchTimerRef.current === null) return
    clearTimeout(prefetchTimerRef.current)
    prefetchTimerRef.current = null
  }, [])

  /** Runs the caller's intent warmer; the route payload is left to the navigation. */
  const warmForIntent = () => {
    cancelScheduledPrefetch()
    if (isCurrentRoute || navigationIntentRef.current) return
    navigationIntentRef.current = true
    onIntent?.()
  }

  /**
   * Hover and focus land well ahead of a click, so they also prefetch the route payload. A press
   * does not: the navigation follows within a frame or two, and a prefetch started then is a
   * second request the navigation ends up waiting on (tree, then data) instead of its own one.
   */
  const prefetchForIntent = () => {
    cancelScheduledPrefetch()
    if (isCurrentRoute) return
    warmForIntent()
    setShouldPrefetchRoute(true)
  }

  const schedulePrefetch = () => {
    cancelScheduledPrefetch()
    prefetchTimerRef.current = setTimeout(() => {
      prefetchTimerRef.current = null
      prefetchForIntent()
    }, SETTINGS_PREFETCH_DWELL_MS)
  }

  const clearIntent = () => {
    cancelScheduledPrefetch()
    navigationIntentRef.current = false
    setShouldPrefetchRoute(false)
  }

  useEffect(() => cancelScheduledPrefetch, [cancelScheduledPrefetch])

  return (
    <Link
      {...props}
      prefetch={!isCurrentRoute && shouldPrefetchRoute}
      onMouseEnter={(event) => {
        onMouseEnter?.(event)
        if (!event.defaultPrevented) schedulePrefetch()
      }}
      onMouseLeave={(event) => {
        onMouseLeave?.(event)
        clearIntent()
      }}
      onFocus={(event) => {
        onFocus?.(event)
        if (!event.defaultPrevented) prefetchForIntent()
      }}
      onBlur={(event) => {
        onBlur?.(event)
        clearIntent()
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event)
        if (event.pointerType === 'mouse' && isUnmodifiedPrimaryPointer(event)) {
          warmForIntent()
        }
      }}
      onPointerUp={(event) => {
        onPointerUp?.(event)
        if (event.pointerType !== 'mouse' && isUnmodifiedPrimaryPointer(event)) {
          warmForIntent()
        }
      }}
      onPointerCancel={(event) => {
        onPointerCancel?.(event)
        clearIntent()
      }}
      onTouchStart={onTouchStart}
      onClick={(event) => {
        onClick?.(event)
        if (
          !event.defaultPrevented &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          !isCurrentRoute &&
          !navigationIntentRef.current
        ) {
          warmForIntent()
        }
      }}
    />
  )
}
