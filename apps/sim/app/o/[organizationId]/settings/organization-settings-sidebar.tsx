'use client'

import { useQueryClient } from '@tanstack/react-query'
import { usePathname } from 'next/navigation'
import { ORGANIZATION_SETTINGS_GROUPS } from '@/components/settings/navigation'
import { SettingsSidebar } from '@/components/settings/settings-sidebar'
import { isApiClientError } from '@/lib/api/client/errors'
import { isEnterprise } from '@/lib/billing/plan-helpers'
import { hasUsableSubscriptionAccess } from '@/lib/billing/subscriptions/utils'
import { organizationRoutes, WORKSPACE_SETTINGS_PATH } from '@/lib/navigation/paths'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import {
  organizationSurfaceSettingsNavigation,
  resolveOrganizationSurfaceSection,
} from '@/app/o/[organizationId]/settings/navigation'
import { warmOrganizationSettingsSectionQuery } from '@/app/o/[organizationId]/settings/settings-query-warmers'
import { useOrganizationBillingSummary } from '@/hooks/queries/organization-billing-summary'

interface OrganizationSettingsSidebarProps {
  isCollapsed: boolean
  showCollapsedTooltips: boolean
}

export function OrganizationSettingsSidebar(props: OrganizationSettingsSidebarProps) {
  const { organization, viewer, connectedAccountsAvailable, searchAccess, settingsFeatures } =
    useOrganizationContext()
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const refreshPlan = viewer.isAdmin && settingsFeatures.hosted && settingsFeatures.billingEnabled
  const { data: summary, error } = useOrganizationBillingSummary(organization.id, {
    enabled: refreshPlan,
  })
  const accessDenied =
    refreshPlan && isApiClientError(error) && [401, 403, 404].includes(error.status)
  const isAdmin = viewer.isAdmin && !accessDenied
  /** Server features paint immediately; the shared summary keeps portal changes current on focus. */
  const features = {
    ...settingsFeatures,
    hasEnterprisePlan:
      refreshPlan && summary
        ? summary.data.subscriptionState === 'active' &&
          isEnterprise(summary.data.subscriptionPlan) &&
          hasUsableSubscriptionAccess(summary.data.subscriptionStatus, summary.data.billingBlocked)
        : settingsFeatures.hasEnterprisePlan,
  }

  const routes = organizationRoutes(organization.id)

  return (
    <SettingsSidebar
      {...props}
      plane='organization'
      activeSection={resolveOrganizationSurfaceSection(pathname ?? '')?.section ?? 'general'}
      groups={ORGANIZATION_SETTINGS_GROUPS}
      items={organizationSurfaceSettingsNavigation(isAdmin, features, {
        connectedAccounts: connectedAccountsAvailable,
        search: searchAccess.memberScoped,
      })}
      hrefForSection={(section) => routes.settingsSection(section)}
      onSectionIntent={(section) =>
        warmOrganizationSettingsSectionQuery(
          queryClient,
          { organizationId: organization.id, isAdmin },
          section
        )
      }
      backHref={searchAccess.memberScoped ? routes.home : WORKSPACE_SETTINGS_PATH}
    />
  )
}
