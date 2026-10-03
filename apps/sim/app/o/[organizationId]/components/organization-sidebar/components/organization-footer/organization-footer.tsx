'use client'

import type { ComponentProps } from 'react'
import { useRouter } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { SidebarFooter } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-footer/sidebar-footer'

interface OrganizationFooterProps
  extends Omit<
    ComponentProps<typeof SidebarFooter>,
    'accountSettingsHref' | 'onOpenAccountSettings' | 'navigationLinks'
  > {}

export function OrganizationFooter(props: OrganizationFooterProps) {
  const { organization } = useOrganizationContext()
  const router = useRouter()
  const accountSettingsHref = organizationRoutes(organization.id).settingsSection('general')

  return (
    <SidebarFooter
      {...props}
      accountSettingsHref={accountSettingsHref}
      onOpenAccountSettings={() => router.push(accountSettingsHref)}
      navigationLinks={[]}
    />
  )
}
