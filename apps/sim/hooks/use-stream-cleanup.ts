'use client'

import { useCallback, useEffect } from 'react'

/**
 * Generic hook to handle stream cleanup on page unload and component unmount
 * This ensures that ongoing streams are properly terminated when:
 * - Page is refreshed
 * - User navigates away
 * - Component unmounts
 * - Tab is closed
 */
export function useStreamCleanup(cleanup: () => void) {
  const stableCleanup = useCallback(() => {
    try {
      cleanup()
    } catch (error) {
      console.warn('Error during stream cleanup:', error)
    }
  }, [cleanup])

  useEffect(() => {
    const handleBeforeUnload = () => {
      stableCleanup()
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      stableCleanup()
    }
  }, [stableCleanup])
}
