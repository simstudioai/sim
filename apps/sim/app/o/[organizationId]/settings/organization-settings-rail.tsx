'use client'

import type { ComponentProps } from 'react'
import { OrganizationSettingsSidebar } from '@/app/o/[organizationId]/settings/organization-settings-sidebar'

/**
 * Settings' own navigation inside the organization rail. It keeps the rail markup its chips read:
 * collapsed labels hide through `.sidebar-container`, and their width through `group/rail`.
 */
export function OrganizationSettingsRail(
  props: ComponentProps<typeof OrganizationSettingsSidebar>
) {
  return (
    <div
      className='group/rail sidebar-container flex h-full flex-col overflow-hidden bg-[var(--surface-1)] [&_.group.cursor-pointer]:duration-0'
      data-collapsed={props.isCollapsed || undefined}
    >
      <OrganizationSettingsSidebar {...props} />
    </div>
  )
}
