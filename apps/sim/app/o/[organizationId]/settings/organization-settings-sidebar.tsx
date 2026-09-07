'use client'

import { usePathname } from 'next/navigation'
import {
  getOrganizationSettingsFeatures,
  getOrganizationSettingsHref,
  ORGANIZATION_SETTINGS_GROUPS,
} from '@/components/settings/navigation'
import { SettingsSidebar } from '@/components/settings/settings-sidebar'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { organizationRoutes } from '@/lib/navigation/paths'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import {
  organizationSettingsNavigation,
  resolveOrganizationSettingsSection,
} from '@/app/o/[organizationId]/settings/navigation'
import { useOrganizationBilling } from '@/hooks/queries/organization'

interface OrganizationSettingsSidebarProps {
  isCollapsed: boolean
  showCollapsedTooltips: boolean
}

export function OrganizationSettingsSidebar(props: OrganizationSettingsSidebarProps) {
  const { organization, viewer } = useOrganizationContext()
  const pathname = usePathname()
  const deployment = useDeploymentShape()
  const { data: billing } = useOrganizationBilling(organization.id, {
    enabled: viewer.isAdmin && deployment.hosted,
  })
  const features = getOrganizationSettingsFeatures(
    isEnterprise(billing?.data?.subscriptionPlan),
    deployment
  )

  return (
    <SettingsSidebar
      {...props}
      plane='organization'
      activeSection={resolveOrganizationSettingsSection(pathname ?? '') ?? 'members'}
      groups={ORGANIZATION_SETTINGS_GROUPS}
      items={organizationSettingsNavigation(viewer.isAdmin, features)}
      hrefForSection={(section) => getOrganizationSettingsHref(organization.id, section)}
      backHref={organizationRoutes(organization.id).home}
    />
  )
}
