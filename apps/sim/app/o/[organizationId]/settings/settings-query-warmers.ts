import type { QueryClient } from '@tanstack/react-query'
import type {
  AccountSettingsSection,
  OrganizationSettingsSection,
} from '@/components/settings/navigation'
import {
  organizationBillingQueryOptions,
  organizationDetailQueryOptions,
  organizationRosterQueryOptions,
} from '@/hooks/queries/organization'
import { organizationBillingSummaryOptions } from '@/hooks/queries/organization-billing-summary'
import { prefetchQueryOnIntent } from '@/hooks/queries/utils/prefetch-query-on-intent'

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
      prefetchQueryOnIntent(queryClient, organizationBillingQueryOptions(organizationId))
    }
  }
  if (section === 'billing' && isAdmin) {
    prefetchQueryOnIntent(queryClient, organizationBillingSummaryOptions(organizationId))
  }
}
