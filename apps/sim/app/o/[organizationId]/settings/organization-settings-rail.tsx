'use client'

import { OrganizationSettingsSidebar } from '@/app/o/[organizationId]/settings/organization-settings-sidebar'

interface OrganizationSettingsRailProps {
  collapsed: boolean
}

/**
 * Settings' own navigation inside the organization rail. It keeps the rail markup its chips read:
 * collapsed labels hide through `.sidebar-container`, and their width through `group/rail`.
 */
export function OrganizationSettingsRail({ collapsed }: OrganizationSettingsRailProps) {
  return (
    <div
      className='group/rail sidebar-container flex h-full flex-col overflow-hidden bg-[var(--surface-1)] [&_.group.cursor-pointer]:duration-0'
      data-collapsed={collapsed || undefined}
    >
      <OrganizationSettingsSidebar isCollapsed={collapsed} showCollapsedTooltips={collapsed} />
    </div>
  )
}
