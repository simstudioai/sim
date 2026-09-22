'use client'

import type { ComponentProps } from 'react'
import { ListChecks } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { createSerializer } from 'nuqs/server'
import { organizationRoutes } from '@/lib/navigation/paths'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { SidebarFooter } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/sidebar-footer/sidebar-footer'
import { accessRequestEntrySearchParams } from '@/ee/access-requests/components/search-params'

const serializeAccessRequestParams = createSerializer(accessRequestEntrySearchParams)

interface OrganizationFooterProps
  extends Omit<
    ComponentProps<typeof SidebarFooter>,
    'accountSettingsHref' | 'onOpenAccountSettings' | 'navigationLinks'
  > {}

export function OrganizationFooter(props: OrganizationFooterProps) {
  const { organization } = useOrganizationContext()
  const router = useRouter()
  const accountSettingsHref = organizationRoutes(organization.id).settingsSection('general')
  const accessRequestsHref = serializeAccessRequestParams('/access-requests', {
    organizationId: organization.id,
  })

  return (
    <SidebarFooter
      {...props}
      accountSettingsHref={accountSettingsHref}
      onOpenAccountSettings={() => router.push(accountSettingsHref)}
      navigationLinks={[
        {
          label: 'My access requests',
          icon: ListChecks,
          href: accessRequestsHref,
          onNavigate: () => router.push(accessRequestsHref),
        },
      ]}
    />
  )
}
