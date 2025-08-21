'use client'

import { useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import { useSession } from '@/lib/auth-client'
import { useGeneralStore } from '@/stores/settings/general/store'

/**
 * Syncs the theme from the general store with next-themes
 * Only loads settings from DB for authenticated users to avoid unnecessary API calls
 */
export function ThemeSync() {
  const { setTheme, theme: nextTheme, resolvedTheme } = useTheme()
  const { data: session, isPending } = useSession()
  const storeTheme = useGeneralStore((state) => state.theme)
  const loadSettings = useGeneralStore((state) => state.loadSettings)
  const hasLoadedRef = useRef(false)

  // Only load settings for authenticated users
  useEffect(() => {
    if (!isPending && session?.user && !hasLoadedRef.current) {
      hasLoadedRef.current = true
      loadSettings()
    }
  }, [isPending, session?.user, loadSettings])

  // Sync store theme with next-themes only if they differ
  // This prevents unnecessary re-renders and potential flashes
  useEffect(() => {
    // Skip if still loading auth or if themes match
    if (isPending || !storeTheme || storeTheme === nextTheme) {
      return
    }

    // Only sync if user is authenticated (has DB settings)
    // For unauthenticated users, next-themes handles everything via localStorage
    if (session?.user) {
      setTheme(storeTheme)
    }
  }, [storeTheme, nextTheme, setTheme, session?.user, isPending])

  return null
}
