'use client'

import { useEffect, useRef } from 'react'
import { useSession } from '@/lib/auth-client'
import { useGeneralSettings } from '@/hooks/queries/general-settings'

/**
 * Loads user settings from database once per workspace session.
 * React Query handles the fetching and automatically syncs to Zustand store.
 * This ensures settings are available throughout the app.
 */
export function SettingsLoader() {
  const { data: session, isPending: isSessionPending } = useSession()
  const hasLoadedRef = useRef(false)

  // Use React Query hook which automatically syncs to Zustand
  // This replaces the old Zustand loadSettings() call
  const { refetch } = useGeneralSettings()

  useEffect(() => {
    // Only load settings once per session for authenticated users
    if (!isSessionPending && session?.user && !hasLoadedRef.current) {
      hasLoadedRef.current = true
      // Force refetch from DB on initial workspace entry
      refetch()
    }
  }, [isSessionPending, session?.user, refetch])

  return null
}
