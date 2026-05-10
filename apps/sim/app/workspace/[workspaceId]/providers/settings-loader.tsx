'use client'

import { useGeneralSettings } from '@/hooks/queries/general-settings'

/**
 * Eagerly warms the settings cache on workspace entry.
 * React Query handles fetching, caching, and deduplication automatically.
 */
export function SettingsLoader() {
  useGeneralSettings()
  return null
}
