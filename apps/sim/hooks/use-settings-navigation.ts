'use client'

import { useCallback } from 'react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import { WORKSPACE_SETTINGS_ITEMS } from '@/components/settings/navigation'
import type { WorkspaceHostContext } from '@/lib/api/contracts/workspaces'
import { useSession } from '@/lib/auth/auth-client'
import { canManageWorkspaceBilling } from '@/lib/billing/workspace-permissions'
import { APP_ENTRY_PATH } from '@/lib/navigation/paths'
import { popSettingsReturnUrl, rememberSettingsReturnUrl } from '@/lib/navigation/settings-return'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import type { SettingsSection } from '@/app/workspace/[workspaceId]/settings/navigation'

interface SettingsNavigationOptions {
  section?: SettingsSection
  credentialId?: string
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
  const pathname = `/workspace/${workspaceId}/settings/${section}${section === 'secrets' && options?.credentialId ? `/${options.credentialId}` : ''}`
  return query ? `${pathname}?${query}` : pathname
}

export function useSettingsNavigation(): UseSettingsNavigationReturn {
  const router = useRouter()
  const params = useParams<{ workspaceId?: string }>()
  const hostContext = useOptionalWorkspaceHostContext()
  const workspaceId = hostContext?.workspace.id ?? params.workspaceId
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { data: session } = useSession()

  const settingsPrefix = `/workspace/${workspaceId}/settings/`

  const getSettingsHref = useCallback(
    (options?: SettingsNavigationOptions): string => {
      const section = options?.section ?? 'general'
      if (
        pathname.startsWith('/o/') &&
        workspaceId &&
        (section === 'general' ||
          WORKSPACE_SETTINGS_ITEMS.some(
            (item) => (item.id === 'api-keys' ? 'apikeys' : item.id) === section
          ))
      ) {
        const query = new URLSearchParams(searchParams.toString())
        query.set('project', workspaceId)
        query.set('pane', 'project')
        query.set('section', 'settings')
        query.set('setting', section === 'apikeys' ? 'api-keys' : section)
        query.delete('credential')
        query.delete('secret-view')
        query.delete('usage-tab')
        if (options?.credentialId) query.set('credential', options.credentialId)
        if (options?.mcpServerId) query.set('mcpServerId', options.mcpServerId)
        return `${pathname}?${query}`
      }
      return resolveSettingsHref({
        options,
        workspaceId,
        hostContext: hostContext ?? undefined,
        viewerUserId: session?.user?.id,
      })
    },
    [hostContext, session?.user?.id, workspaceId, pathname, searchParams]
  )

  const navigateToSettings = useCallback(
    (options?: SettingsNavigationOptions) => {
      const currentPath = window.location.pathname
      if (currentPath.startsWith(settingsPrefix)) {
        router.replace(getSettingsHref(options), { scroll: false })
      } else {
        rememberSettingsReturnUrl(getSettingsHref(options))
        router.push(getSettingsHref(options))
      }
    },
    [router, settingsPrefix, getSettingsHref]
  )

  return { navigateToSettings, getSettingsHref, popSettingsReturnUrl }
}
