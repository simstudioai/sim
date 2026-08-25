import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MOTHERSHIP_NAVIGATION_REQUEST_EVENT,
  type MothershipNavigationRequestDetail,
} from '@/lib/mothership/events'

interface ResourceTransitionGuard {
  showDiscardConfirmation: boolean
  reportResourceDirty: (resourceId: string, dirty: boolean) => void
  requestResourceTransition: (transition: () => void) => void
  routeAutomaticResourceFocus: (
    activeResourceId: string | null,
    nextResourceId: string,
    focus: () => void,
    markAttention: () => void
  ) => void
  dismissDiscardConfirmation: () => void
  confirmDiscard: () => void
  reset: () => void
}

/**
 * Owns the one dirty draft that can be mounted in Sim Chat's resource panel.
 * User transitions wait for confirmation, while agent-driven focus is routed
 * to the tab's attention state without interrupting the editor.
 */
export function useResourceTransitionGuard(): ResourceTransitionGuard {
  const dirtyResourceIdRef = useRef<string | null>(null)
  const pendingTransitionRef = useRef<(() => void) | null>(null)
  const hasHistorySentinelRef = useRef(false)
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false)

  const seedHistorySentinel = useCallback(() => {
    if (hasHistorySentinelRef.current) return
    window.history.pushState(null, '', window.location.href)
    hasHistorySentinelRef.current = true
  }, [])

  const retireHistorySentinel = useCallback((afterRetirement?: () => void) => {
    if (!hasHistorySentinelRef.current) {
      afterRetirement?.()
      return
    }
    hasHistorySentinelRef.current = false
    if (afterRetirement) {
      window.addEventListener('popstate', afterRetirement, { once: true })
    }
    window.history.back()
  }, [])

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
    (
      activeResourceId: string | null,
      nextResourceId: string,
      focus: () => void,
      markAttention: () => void
    ) => {
      if (dirtyResourceIdRef.current === activeResourceId && activeResourceId !== nextResourceId) {
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
    hasHistorySentinelRef.current = false
    setShowDiscardConfirmation(false)
  }, [])

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
      hasHistorySentinelRef.current = false
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
        (destination.pathname === current.pathname &&
          destination.search === current.search &&
          destination.hash === current.hash)
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
    reset,
  }
}
