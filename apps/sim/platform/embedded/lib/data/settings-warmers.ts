'use client'

import type { QueryClient } from '@tanstack/react-query'
import type {
  AccountSettingsSection,
  OrganizationSettingsSection,
} from '@/components/settings/navigation'
import { canReadMemberIntegrations } from '@/lib/credential-groups/member-integrations'
import { organizationRoutes } from '@/lib/navigation/paths'
import { useOrganization } from '@/lib/organizations/provider'
import {
  organizationDetailQueryOptions,
  organizationRosterQueryOptions,
} from '@/hooks/queries/organization'
import { organizationBillingSummaryOptions } from '@/hooks/queries/organization-billing-summary'
import { organizationPlanSeatsOptions } from '@/hooks/queries/organization-plan-seats'
import { prefetchQueryOnIntent } from '@/hooks/queries/utils/prefetch-query-on-intent'
import { useNavWarmers as useSharedNavWarmers } from '@/platform/shared/nav-warmers'

interface OrganizationSettingsQueryWarmContext {
  organizationId: string
  isAdmin: boolean
}

/** Warms the selected panel's existing cache entries without mounting hidden query observers. */
export function warmOrganizationSettingsSectionQuery(
  queryClient: QueryClient,
  { organizationId, isAdmin }: OrganizationSettingsQueryWarmContext,
  section: AccountSettingsSection | OrganizationSettingsSection
): void {
  if (!organizationId) return

  if (section === 'members') {
    prefetchQueryOnIntent(queryClient, organizationDetailQueryOptions(organizationId))
    prefetchQueryOnIntent(queryClient, organizationRosterQueryOptions(organizationId))
    if (isAdmin) {
      prefetchQueryOnIntent(queryClient, organizationPlanSeatsOptions(organizationId))
    }
  }
  if (section === 'billing' && isAdmin) {
    prefetchQueryOnIntent(queryClient, organizationBillingSummaryOptions(organizationId))
  }
}

export function useNavWarmers() {
  const context = useOrganization()
  const organizationId = context.organization.id
  const isAdmin = context.viewer.isAdmin
  return useSharedNavWarmers({
    organizationId,
    isAdmin,
    canReadIntegrations: canReadMemberIntegrations(context),
    simLinksDestination: 'sim-links',
    settingsHref: (section) => organizationRoutes(organizationId).settingsSection(section),
    warmSettingsSection: (queryClient, section) =>
      warmOrganizationSettingsSectionQuery(queryClient, { organizationId, isAdmin }, section),
  })
}
