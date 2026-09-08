'use client'

import { usePathname } from 'next/navigation'
import {
  getOrganizationSettingsFeatures,
  ORGANIZATION_SETTINGS_GROUPS,
} from '@/components/settings/navigation'
import { SettingsSidebar } from '@/components/settings/settings-sidebar'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import {
  organizationSurfaceSettingsNavigation,
  resolveOrganizationSurfaceSection,
} from '@/app/o/[organizationId]/settings/navigation'
import { useOrganizationBilling } from '@/hooks/queries/organization'

interface OrganizationSettingsSidebarProps {
  isCollapsed: boolean
  showCollapsedTooltips: boolean
}

export function OrganizationSettingsSidebar(props: OrganizationSettingsSidebarProps) {
  const { organization, viewer, connectedAccountsAvailable, searchAccess } =
    useOrganizationContext()
  const pathname = usePathname()
  const deployment = useDeploymentShape()
  const { data: billing } = useOrganizationBilling(organization.id, {
    enabled: viewer.isAdmin && deployment.hosted,
  })
  const features = getOrganizationSettingsFeatures(
    isEnterprise(billing?.data?.subscriptionPlan),
    deployment
  )

  const routes = organizationRoutes(organization.id)

  return (
    <SettingsSidebar
      {...props}
      plane='organization'
      activeSection={resolveOrganizationSurfaceSection(pathname ?? '')?.section ?? 'general'}
      groups={ORGANIZATION_SETTINGS_GROUPS}
      items={organizationSurfaceSettingsNavigation(viewer.isAdmin, features, {
        connectedAccounts: connectedAccountsAvailable,
        search: searchAccess.memberScoped,
      })}
      hrefForSection={(section) => routes.settingsSection(section)}
      backHref={searchAccess.memberScoped ? routes.home : WORKSPACE_SETTINGS_PATH}
    />
  )
}
