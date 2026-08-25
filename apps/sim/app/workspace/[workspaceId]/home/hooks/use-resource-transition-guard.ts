import { useCallback, useEffect, useRef, useState } from 'react'
import { generateId } from '@sim/utils/id'
import {
  MOTHERSHIP_NAVIGATION_REQUEST_EVENT,
  type MothershipNavigationRequestDetail,
} from '@/lib/mothership/events'

interface ResourceTransitionGuard {
  showDiscardConfirmation: boolean
  reportResourceDirty: (resourceId: string, dirty: boolean) => void
  requestResourceTransition: (transition: () => void) => void
  routeAutomaticResourceFocus: (
    nextResourceId: string,
    focus: () => void,
    markAttention: () => void
  ) => void
  dismissDiscardConfirmation: () => void
  confirmDiscard: () => void
  rebaseHistorySentinel: () => void
  reset: () => void
}

const RESOURCE_HISTORY_SENTINEL_KEY = '__simResourceDraftSentinel'

interface HistorySentinel {
  token: string
  url: string
}

/**
 * Owns the one dirty draft that can be mounted in Sim Chat's resource panel.
 * User transitions wait for confirmation, while agent-driven focus is routed
 * to the tab's attention state without interrupting the editor.
 */
export function useResourceTransitionGuard(): ResourceTransitionGuard {
  const dirtyResourceIdRef = useRef<string | null>(null)
  const pendingTransitionRef = useRef<(() => void) | null>(null)
  const historySentinelRef = useRef<HistorySentinel | null>(null)
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false)

  const seedHistorySentinel = useCallback(() => {
    if (historySentinelRef.current) return
    const sentinel = { token: generateId(), url: window.location.href }
    const currentState = window.history.state
    window.history.pushState(
      {
        ...(currentState && typeof currentState === 'object' ? currentState : {}),
        [RESOURCE_HISTORY_SENTINEL_KEY]: sentinel.token,
      },
      '',
      sentinel.url
    )
    historySentinelRef.current = sentinel
  }, [])

  const retireHistorySentinel = useCallback((afterRetirement?: () => void) => {
    const sentinel = historySentinelRef.current
    historySentinelRef.current = null
    const currentState = window.history.state
    const ownsCurrentEntry =
      sentinel !== null &&
      window.location.href === sentinel.url &&
      currentState !== null &&
      typeof currentState === 'object' &&
      currentState[RESOURCE_HISTORY_SENTINEL_KEY] === sentinel.token

    if (!ownsCurrentEntry) {
      afterRetirement?.()
      return
    }
    if (afterRetirement) {
      window.addEventListener('popstate', afterRetirement, { once: true })
    }
    window.history.back()
  }, [])

  const rebaseHistorySentinel = useCallback(() => {
    if (!dirtyResourceIdRef.current) return
    const sentinel = historySentinelRef.current
    const currentState = window.history.state
    const ownsCurrentEntry =
      sentinel !== null &&
      window.location.href === sentinel.url &&
      currentState !== null &&
      typeof currentState === 'object' &&
      currentState[RESOURCE_HISTORY_SENTINEL_KEY] === sentinel.token
    if (ownsCurrentEntry) return

    historySentinelRef.current = null
    seedHistorySentinel()
  }, [seedHistorySentinel])

  const reportResourceDirty = useCallback(
    (resourceId: string, dirty: boolean) => {
      if (dirty) {
        dirtyResourceIdRef.current = resourceId
        seedHistorySentinel()
        return
      }
      if (dirtyResourceIdRef.current !== resourceId) return
      dirtyResourceIdRef.current = null
      pendingTransitionRef.current = null
      setShowDiscardConfirmation(false)
      retireHistorySentinel()
    },
    [retireHistorySentinel, seedHistorySentinel]
  )

  const requestResourceTransition = useCallback((transition: () => void) => {
    if (!dirtyResourceIdRef.current) {
      transition()
      return
    }
    pendingTransitionRef.current = transition
    setShowDiscardConfirmation(true)
  }, [])

  const routeAutomaticResourceFocus = useCallback(
    (nextResourceId: string, focus: () => void, markAttention: () => void) => {
      // Resource upserts run before their focus event. Adding an item can move
      // the derived fallback ID to that new last tab before this callback runs,
      // even though the dirty editor is still what the user sees. The guard is
      // the authoritative owner of that mounted dirty editor, so protect it
      // directly instead of trusting an active ID that may already have moved.
      if (dirtyResourceIdRef.current && dirtyResourceIdRef.current !== nextResourceId) {
        markAttention()
        return
      }
      focus()
    },
    []
  )

  const dismissDiscardConfirmation = useCallback(() => {
    pendingTransitionRef.current = null
    setShowDiscardConfirmation(false)
  }, [])

  const confirmDiscard = useCallback(() => {
    const transition = pendingTransitionRef.current
    pendingTransitionRef.current = null
    dirtyResourceIdRef.current = null
    setShowDiscardConfirmation(false)
    retireHistorySentinel(transition ?? undefined)
  }, [retireHistorySentinel])

  const reset = useCallback(() => {
    dirtyResourceIdRef.current = null
    pendingTransitionRef.current = null
    setShowDiscardConfirmation(false)
    retireHistorySentinel()
  }, [retireHistorySentinel])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyResourceIdRef.current) return
      event.preventDefault()
    }

    const handleNavigationRequest = (event: Event) => {
      const detail = (event as CustomEvent<MothershipNavigationRequestDetail>).detail
      if (typeof detail?.navigate !== 'function') return
      event.preventDefault()
      requestResourceTransition(detail.navigate)
    }

    const handlePopState = () => {
      if (!dirtyResourceIdRef.current) return
      historySentinelRef.current = null
      seedHistorySentinel()
      requestResourceTransition(() => window.history.back())
    }

    /**
     * Next.js handles links before a history listener can block them. Capture
     * same-window app links first, then replay the original click after the
     * user confirms so the link keeps its own routing and selection behavior.
     */
    const handleDocumentClick = (event: MouseEvent) => {
      if (
        !dirtyResourceIdRef.current ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !(event.target instanceof Element)
      ) {
        return
      }

      const anchor = event.target.closest<HTMLAnchorElement>('a[href]')
      if (
        !anchor ||
        anchor.hasAttribute('download') ||
        (anchor.target && anchor.target !== '_self')
      ) {
        return
      }

      const destination = new URL(anchor.href, window.location.href)
      const current = new URL(window.location.href)
      if (
        destination.origin !== current.origin ||
        (destination.pathname === current.pathname && destination.search === current.search)
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      requestResourceTransition(() => anchor.click())
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('popstate', handlePopState)
    window.addEventListener(MOTHERSHIP_NAVIGATION_REQUEST_EVENT, handleNavigationRequest)
    document.addEventListener('click', handleDocumentClick, true)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('popstate', handlePopState)
      window.removeEventListener(MOTHERSHIP_NAVIGATION_REQUEST_EVENT, handleNavigationRequest)
      document.removeEventListener('click', handleDocumentClick, true)
    }
  }, [requestResourceTransition, seedHistorySentinel])

  return {
    showDiscardConfirmation,
    reportResourceDirty,
    requestResourceTransition,
    routeAutomaticResourceFocus,
    dismissDiscardConfirmation,
    confirmDiscard,
    rebaseHistorySentinel,
    reset,
  }
}
