'use client'

import { useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ACCOUNT_SETTINGS_ITEMS,
  getAccountSettingsHref,
  getOrganizationSettingsHref,
  getWorkspaceSettingsHref,
  type SettingsSection,
  WORKSPACE_SETTINGS_ITEMS,
} from '@/components/settings/navigation'
import type { WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import { useSession } from '@/lib/auth/auth-client'
import { canManageWorkspaceBilling } from '@/lib/billing/workspace-permissions'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'

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
  const section = options?.section || 'general'
  const searchParams = new URLSearchParams()
  if (options?.mcpServerId) searchParams.set('mcpServerId', options.mcpServerId)

  if (section === 'billing' && hostContext) {
    if (!canManageWorkspaceBilling(hostContext, viewerUserId)) {
      return workspaceId ? `/workspace/${workspaceId}/upgrade` : getAccountSettingsHref('billing')
    }
    if (hostContext.hostOrganizationId) {
      return getOrganizationSettingsHref(hostContext.hostOrganizationId, 'billing')
    }
  }
  const accountSection = ACCOUNT_SETTINGS_ITEMS.find((item) => item.id === section)
  if (accountSection) return getAccountSettingsHref(accountSection.id, searchParams)

  const workspaceSection = WORKSPACE_SETTINGS_ITEMS.find((item) => item.id === section)
  if (workspaceSection && workspaceId) {
    return getWorkspaceSettingsHref(workspaceId, workspaceSection.id, searchParams)
  }
  return getAccountSettingsHref('general')
}

export function useSettingsNavigation(): UseSettingsNavigationReturn {
  const router = useRouter()
  const params = useParams<{ workspaceId?: string }>()
  const workspaceId = params.workspaceId
  const hostContext = useOptionalWorkspaceHostContext()
  const { data: session } = useSession()

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
      const settingsHref = getSettingsHref(options)
      if (currentPath.includes('/settings/')) {
        router.replace(settingsHref, { scroll: false })
      } else {
        try {
          sessionStorage.setItem(SETTINGS_RETURN_URL_KEY, currentPath)
        } catch {}
        router.push(settingsHref)
      }
    },
    [router, getSettingsHref]
  )

  return { navigateToSettings, getSettingsHref, popSettingsReturnUrl }
}
