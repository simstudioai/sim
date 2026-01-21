'use client'

import { useEffect, useRef } from 'react'

/**
 * Generic hook to handle stream cleanup on component unmount.
 *
 * IMPORTANT: This hook intentionally does NOT cleanup on page refresh/unload.
 * The server stream continues running independently and can be resumed when
 * the client reconnects. Only cleanup on explicit navigation within the app.
 */
export function useStreamCleanup(cleanup: () => void) {
  // Use ref to store cleanup function to avoid recreating effects
  const cleanupRef = useRef(cleanup)
  cleanupRef.current = cleanup

  useEffect(() => {
    // Only cleanup on component unmount (navigation within app)
    // NOT on page unload/refresh - server stream continues independently
    return () => {
      // Check if this is a navigation within the app vs page unload
      // document.visibilityState is 'hidden' during page unload
      if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
        try {
          cleanupRef.current()
        } catch (error) {
          console.warn('Error during stream cleanup:', error)
        }
      }
    }
  }, []) // Empty deps - only run on mount/unmount
}
