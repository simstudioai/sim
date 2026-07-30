'use client'

import { useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import { useSession } from '@/lib/auth/auth-client'
import { canManageWorkspaceBilling } from '@/lib/billing/workspace-permissions'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
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

interface ResolveSettingsHrefParams {
  options?: SettingsNavigationOptions
  workspaceId?: string
  hostContext?: WorkspaceHostContext
  viewerUserId?: string
}

export function resolveSettingsHref({
  options,
  workspaceId,
  hostContext,
  viewerUserId,
}: ResolveSettingsHrefParams): string {
  if (!workspaceId) return '/workspace'
  const section = options?.section || 'general'
  if (
    section === 'billing' &&
    hostContext &&
    !canManageWorkspaceBilling(hostContext, viewerUserId)
  ) {
    return `/workspace/${workspaceId}/upgrade`
  }

  const searchParams = new URLSearchParams()
  if (options?.mcpServerId) searchParams.set('mcpServerId', options.mcpServerId)
  const query = searchParams.toString()
  const pathname = `/workspace/${workspaceId}/settings/${section}`
  return query ? `${pathname}?${query}` : pathname
}

export function useSettingsNavigation(): UseSettingsNavigationReturn {
  const router = useRouter()
  const params = useParams<{ workspaceId?: string }>()
  const workspaceId = params.workspaceId
  const hostContext = useOptionalWorkspaceHostContext()
  const { data: session } = useSession()

  const settingsPrefix = `/workspace/${workspaceId}/settings/`

  const getSettingsHref = useCallback(
    (options?: SettingsNavigationOptions): string =>
      resolveSettingsHref({
        options,
        workspaceId,
        hostContext: hostContext ?? undefined,
        viewerUserId: session?.user?.id,
      }),
    [hostContext, session?.user?.id, workspaceId]
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
        } catch {}
        router.push(getSettingsHref(options))
      }
    },
    [router, settingsPrefix, getSettingsHref]
  )

  return { navigateToSettings, getSettingsHref, popSettingsReturnUrl }
}
