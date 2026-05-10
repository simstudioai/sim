'use client'

import { useSession } from '@/lib/auth/auth-client'
import { useGeneralSettings } from '@/hooks/queries/general-settings'

/**
 * Eagerly loads user settings when the session is ready.
 * React Query handles fetching, caching, and deduplication automatically.
 */
export function SettingsLoader() {
  const { data: session, isPending: isSessionPending } = useSession()

  useGeneralSettings({ enabled: !isSessionPending && !!session?.user })

  return null
}
