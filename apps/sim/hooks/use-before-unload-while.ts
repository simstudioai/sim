'use client'

import { useEffect } from 'react'

/**
 * Asks the browser to confirm before the page unloads while `active` is true, using the
 * standard `beforeunload` prompt. The desktop app's update restart probes this same
 * event, so guarded work also holds an update restart for confirmation.
 */
export function useBeforeUnloadWhile(active: boolean) {
  useEffect(() => {
    if (!active) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [active])
}
