'use client'

import { useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'

interface SettingsNavigationOptions {
  section?: SettingsSection
  mcpServerId?: string
}

interface UseSettingsNavigationReturn {
  navigateToSettings: (options?: SettingsNavigationOptions) => void
  getSettingsHref: (options?: SettingsNavigationOptions) => string
}

export function useSettingsNavigation(): UseSettingsNavigationReturn {
  const router = useRouter()
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const getSettingsHref = useCallback(
    (options?: SettingsNavigationOptions): string => {
      const section = options?.section || 'general'
      const searchParams = options?.mcpServerId ? `?mcpServerId=${options.mcpServerId}` : ''
      return `/workspace/${workspaceId}/settings/${section}${searchParams}`
    },
    [workspaceId]
  )

  const navigateToSettings = useCallback(
    (options?: SettingsNavigationOptions) => {
      router.push(getSettingsHref(options))
    },
    [router, getSettingsHref]
  )

  return { navigateToSettings, getSettingsHref }
}
