'use client'

import type { ComponentProps } from 'react'
import { useRouter } from 'next/navigation'
import { organizationRoutes } from '@/lib/navigation/paths'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { organizationSettingsNavigation } from '@/app/o/[organizationId]/settings/navigation'
import { SidebarFooter } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-footer/sidebar-footer'

interface OrganizationFooterProps
  extends Omit<
    ComponentProps<typeof SidebarFooter>,
    'accountSettingsHref' | 'onOpenAccountSettings' | 'navigationLinks'
  > {}

export function OrganizationFooter(props: OrganizationFooterProps) {
  const { organization, viewer, settingsFeatures, connectedAccountsAvailable, searchAccess } =
    useOrganizationContext()
  const router = useRouter()
  const accountSettingsHref = organizationRoutes(organization.id).settingsSection('general')
  const navigationLinks = organizationSettingsNavigation(viewer.isAdmin, settingsFeatures, {
    connectedAccounts: connectedAccountsAvailable,
    search: searchAccess.memberScoped,
  })
    .filter(({ id }) => id === 'billing' || id === 'members' || id === 'recently-deleted')
    .map(({ id, label, icon }) => {
      const href = organizationRoutes(organization.id).settingsSection(id)
      return { label, icon, href, onNavigate: () => router.push(href) }
    })

  return (
    <SidebarFooter
      {...props}
      accountSettingsHref={accountSettingsHref}
      onOpenAccountSettings={() => router.push(accountSettingsHref)}
      navigationLinks={navigationLinks}
    />
  )
}
