'use client'

import { useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import { useSession } from '@/lib/auth/auth-client'
import { canManageWorkspaceBilling } from '@/lib/billing/workspace-permissions'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'

export const SETTINGS_RETURN_URL_KEY = 'settings-return-url'

interface SettingsNavigationOptions {
  section?: SettingsSection
  mcpServerId?: string
  browserView?: 'passwords'
  browserImport?: boolean
  browserClear?: boolean
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
  if (!workspaceId) return APP_ENTRY_PATH
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
  if (options?.browserView) searchParams.set('browserView', options.browserView)
  if (options?.browserImport) searchParams.set('browserImport', '1')
  if (options?.browserClear) searchParams.set('browserClear', '1')
  const query = searchParams.toString()
  const pathname = `/workspace/${workspaceId}/settings/${section}`
  return query ? `${pathname}?${query}` : pathname
}

interface ResolveSettingsReturnUrlParams {
  storedUrl: string | null
  workspaceId?: string
  fallback: string
}

/**
 * Resolves the stored settings return url, discarding it when it points at a
 * different workspace than the one currently open. Switching workspaces from
 * settings keeps the user on the new workspace, so a return url captured in the
 * old one would silently navigate them back out of it.
 */
export function resolveSettingsReturnUrl({
  storedUrl,
  workspaceId,
  fallback,
}: ResolveSettingsReturnUrlParams): string {
  if (!storedUrl) return fallback
  const [, root, storedWorkspaceId] = storedUrl.split('/')
  if (root === 'workspace' && storedWorkspaceId && storedWorkspaceId !== workspaceId) {
    return fallback
  }
  return storedUrl
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

  const popSettingsReturnUrl = useCallback(
    (fallback: string): string => {
      try {
        const storedUrl = sessionStorage.getItem(SETTINGS_RETURN_URL_KEY)
        sessionStorage.removeItem(SETTINGS_RETURN_URL_KEY)
        return resolveSettingsReturnUrl({ storedUrl, workspaceId, fallback })
      } catch {
        return fallback
      }
    },
    [workspaceId]
  )

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
