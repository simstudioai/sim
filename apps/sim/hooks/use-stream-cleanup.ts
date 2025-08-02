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
  // Wrap cleanup function to ensure it's stable
  const stableCleanup = useCallback(() => {
    try {
      cleanup()
    } catch (error) {
      // Ignore errors during cleanup to prevent issues during page unload
      console.warn('Error during stream cleanup:', error)
    }
  }, [cleanup])

  useEffect(() => {
    // Handle page unload/navigation/refresh
    const handleBeforeUnload = () => {
      stableCleanup()
    }

    // Add event listeners
    window.addEventListener('beforeunload', handleBeforeUnload)

    // Cleanup on component unmount
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      stableCleanup()
    }
  }, [stableCleanup])
}
