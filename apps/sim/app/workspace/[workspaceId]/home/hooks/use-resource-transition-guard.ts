import { useCallback, useRef, useState } from 'react'

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
