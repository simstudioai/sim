'use client'

import { useEffect, useRef } from 'react'
import { useSession } from '@/lib/auth-client'
import { useGeneralStore } from '@/stores/settings/general/store'

/**
 * Loads user settings from database once per workspace session.
 * This ensures settings are synced from DB on initial load but uses
 * localStorage cache for subsequent navigation within the app.
 */
export function SettingsLoader() {
  const { data: session, isPending: isSessionPending } = useSession()
  const loadSettings = useGeneralStore((state) => state.loadSettings)
  const hasLoadedRef = useRef(false)

  useEffect(() => {
    // Only load settings once per session for authenticated users
    if (!isSessionPending && session?.user && !hasLoadedRef.current) {
      hasLoadedRef.current = true
      // Force load from DB on initial workspace entry
      loadSettings(true)
    }
  }, [isSessionPending, session?.user, loadSettings])

  return null
}
