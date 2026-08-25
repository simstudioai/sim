import { useCallback, useEffect, useRef, useState } from 'react'

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
  const [showDiscardConfirmation, setShowDiscardConfirmation] = useState(false)

  const reportResourceDirty = useCallback((resourceId: string, dirty: boolean) => {
    if (dirty) {
      dirtyResourceIdRef.current = resourceId
      return
    }
    if (dirtyResourceIdRef.current !== resourceId) return
    dirtyResourceIdRef.current = null
    pendingTransitionRef.current = null
    setShowDiscardConfirmation(false)
  }, [])

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
    transition?.()
  }, [])

  const reset = useCallback(() => {
    dirtyResourceIdRef.current = null
    pendingTransitionRef.current = null
    setShowDiscardConfirmation(false)
  }, [])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyResourceIdRef.current) return
      event.preventDefault()
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
    document.addEventListener('click', handleDocumentClick, true)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('click', handleDocumentClick, true)
    }
  }, [requestResourceTransition])

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
