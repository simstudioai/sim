'use client'

import { useMemo } from 'react'
import { useParams, usePathname } from 'next/navigation'
import {
  getWorkspaceSettingsHref,
  parseSettingsPathSection,
  resolveWorkspaceNavigation,
  WORKSPACE_SETTINGS_GROUPS,
  WORKSPACE_SETTINGS_ITEMS,
  WORKSPACE_SETTINGS_PATH_ALIASES,
} from '@/components/settings/navigation'
import { SettingsSidebar as SharedSettingsSidebar } from '@/components/settings/settings-sidebar'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { isHosted } from '@/lib/core/config/env-flags'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { useForkingAvailable } from '@/ee/workspace-forking/hooks/use-forking-available'
import { useInboxConfig } from '@/hooks/queries/inbox'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

interface SettingsSidebarProps {
  isCollapsed?: boolean
  showCollapsedTooltips?: boolean
}

export function SettingsSidebar({
  isCollapsed = false,
  showCollapsedTooltips = false,
}: SettingsSidebarProps) {
  const params = useParams<{ workspaceId: string }>()
  const pathname = usePathname()
  const workspaceId = params.workspaceId
  const hostContext = useWorkspaceHostContext()
  const { config: permissionConfig } = usePermissionConfig()
  const { data: inboxConfig } = useInboxConfig(workspaceId)
  const forkingAvailable = useForkingAvailable(workspaceId)
  const { popSettingsReturnUrl } = useSettingsNavigation()
  const customBlocksAvailable = isHosted
    ? hostContext.ownerBilling.isEnterprise
    : isTruthy(getEnv('NEXT_PUBLIC_CUSTOM_BLOCKS_ENABLED'))

  const items = useMemo(
    () =>
      resolveWorkspaceNavigation({
        permission: hostContext.viewer.permission,
        permissionConfig,
        entitlements: {
          byok: isHosted,
          inbox: inboxConfig?.entitled ?? false,
          customBlocks: customBlocksAvailable,
          forks: forkingAvailable,
        },
      }),
    [customBlocksAvailable, forkingAvailable, hostContext, inboxConfig?.entitled, permissionConfig]
  )

  const activeSection = useMemo(
    () =>
      parseSettingsPathSection({
        path: pathname,
        items: WORKSPACE_SETTINGS_ITEMS,
        defaultSection: 'teammates',
        aliases: WORKSPACE_SETTINGS_PATH_ALIASES,
      }),
    [pathname]
  )

  return (
    <SharedSettingsSidebar
      activeSection={activeSection}
      backHref={popSettingsReturnUrl(`/workspace/${workspaceId}/home`)}
      groups={WORKSPACE_SETTINGS_GROUPS}
      hrefForSection={(section) => getWorkspaceSettingsHref(workspaceId, section)}
      items={items}
      isCollapsed={isCollapsed}
      showCollapsedTooltips={showCollapsedTooltips}
    />
  )
}
