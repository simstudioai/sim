'use client'

import { useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'

const SETTINGS_RETURN_URL_KEY = 'settings-return-url'

interface SettingsNavigationOptions {
  section?: SettingsSection
  mcpServerId?: string
}

interface UseSettingsNavigationReturn {
  navigateToSettings: (options?: SettingsNavigationOptions) => void
  getSettingsHref: (options?: SettingsNavigationOptions) => string
  popSettingsReturnUrl: (fallback: string) => string
}

export function useSettingsNavigation(): UseSettingsNavigationReturn {
  const router = useRouter()
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const settingsPrefix = `/workspace/${workspaceId}/settings/`

  const getSettingsHref = useCallback(
    (options?: SettingsNavigationOptions): string => {
      const section = options?.section || 'general'
      const searchParams = options?.mcpServerId ? `?mcpServerId=${options.mcpServerId}` : ''
      return `${settingsPrefix}${section}${searchParams}`
    },
    [settingsPrefix]
  )

  const popSettingsReturnUrl = useCallback((fallback: string): string => {
    try {
      const url = sessionStorage.getItem(SETTINGS_RETURN_URL_KEY)
      sessionStorage.removeItem(SETTINGS_RETURN_URL_KEY)
      return url ?? fallback
    } catch {
      return fallback
    }
  }, [])

  const navigateToSettings = useCallback(
    (options?: SettingsNavigationOptions) => {
      const currentPath = window.location.pathname
      if (currentPath.startsWith(settingsPrefix)) {
        router.replace(getSettingsHref(options), { scroll: false })
      } else {
        try {
          sessionStorage.setItem(SETTINGS_RETURN_URL_KEY, currentPath)
        } catch {
          // Ignore storage errors
        }
        router.push(getSettingsHref(options))
      }
    },
    [router, settingsPrefix, getSettingsHref]
  )

  return { navigateToSettings, getSettingsHref, popSettingsReturnUrl }
}
