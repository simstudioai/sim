'use client'

import type { QueryClient } from '@tanstack/react-query'
import { canReadMemberIntegrations } from '@/lib/credential-groups/member-integrations'
import {
  organizationDetailQueryOptions,
  organizationRosterQueryOptions,
} from '@/hooks/queries/organization'
import { organizationPlanSeatsOptions } from '@/hooks/queries/organization-plan-seats'
import { prefetchQueryOnIntent } from '@/hooks/queries/utils/prefetch-query-on-intent'
import { useOrganization } from '@/platform/lib/data/organization'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { useNavWarmers as useSharedNavWarmers } from '@/platform/shared/nav-warmers'

/**
 * @public Ready for the sidebar's destination rows, which have no pointer handler yet: `schedule` on
 * enter, `cancel` on leave, `warmSettings` when a menu holding a Settings entry opens.
 */
export function useNavWarmers() {
  const organization = useOrganization()
  const organizationId = organization.organization.id
  const isAdmin = organization.viewer.isAdmin
  return useSharedNavWarmers({
    organizationId,
    isAdmin,
    canReadIntegrations: canReadMemberIntegrations(organization),
    simLinksDestination: organization.navFlags.simLinks ? 'links' : undefined,
    settingsHref: (section) => surfaceHref(organization, `/settings/${section}`),
    warmSettingsSection: (queryClient: QueryClient, section) => {
      if (section !== 'members') return
      prefetchQueryOnIntent(queryClient, organizationDetailQueryOptions(organizationId))
      prefetchQueryOnIntent(queryClient, organizationRosterQueryOptions(organizationId))
      if (isAdmin) prefetchQueryOnIntent(queryClient, organizationPlanSeatsOptions(organizationId))
    },
  })
}
