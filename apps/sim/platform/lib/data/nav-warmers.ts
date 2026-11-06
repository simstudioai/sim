'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { canReadMemberIntegrations } from '@/lib/credential-groups/member-integrations'
import { simLinksSortParams } from '@/lib/sim-links/search-params'
import {
  organizationDetailQueryOptions,
  organizationRosterQueryOptions,
} from '@/hooks/queries/organization'
import { organizationAccountsQueryOptions } from '@/hooks/queries/organization-accounts'
import { organizationPlanSeatsOptions } from '@/hooks/queries/organization-plan-seats'
import { peopleListQueryOptions } from '@/hooks/queries/people'
import { searchIntegrationsQueryOptions } from '@/hooks/queries/search-integrations'
import { simLinksQueryOptions } from '@/hooks/queries/sim-links'
import {
  dropFailedSpeculativeQuery,
  prefetchQueryOnIntent,
} from '@/hooks/queries/utils/prefetch-query-on-intent'
import { useOrganization } from '@/platform/lib/data/organization'
import { surfaceHref } from '@/platform/lib/data/organization-model'

const NAV_WARM_DWELL_MS = 80

/**
 * Reads a nav row's page ahead of an intended open, through the options its hooks read, so the keys
 * and payloads are the same ones. Only the cheap database reads: slow provider reads stay on the page.
 *
 * @public Ready for the sidebar's destination rows, which have no pointer handler yet: `schedule` on
 * enter, `cancel` on leave, `warmSettings` when a menu holding a Settings entry opens.
 */
export function useNavWarmers() {
  const organization = useOrganization()
  const organizationId = organization.organization.id
  const queryClient = useQueryClient()
  const router = useRouter()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function cancel() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  useEffect(() => cancel, [])

  function warm(destination: string) {
    if (destination === 'integrations' && canReadMemberIntegrations(organization)) {
      prefetchQueryOnIntent(queryClient, organizationAccountsQueryOptions(organizationId))
      prefetchQueryOnIntent(queryClient, searchIntegrationsQueryOptions(organizationId))
    }
    if (destination === 'people' && organization.viewer.isAdmin) {
      const options = peopleListQueryOptions(organizationId, '', '', { scope: 'roots' })
      void queryClient
        .prefetchInfiniteQuery(options)
        .then(() => dropFailedSpeculativeQuery(queryClient, options.queryKey))
    }
    if (destination === 'links' && organization.navFlags.simLinks) {
      const { column, direction } = simLinksSortParams.default
      const options = simLinksQueryOptions(organizationId, '', column, direction)
      void queryClient
        .prefetchInfiniteQuery(options)
        .then(() => dropFailedSpeculativeQuery(queryClient, options.queryKey))
    }
  }

  return {
    cancel,
    schedule(destination: string) {
      cancel()
      timer.current = setTimeout(() => warm(destination), NAV_WARM_DWELL_MS)
    },
    /** A menu holding a Settings entry just opened, so its section's route and reads go ahead. */
    warmSettings(section: 'general' | 'members') {
      router.prefetch(surfaceHref(organization, `/settings/${section}`))
      if (section !== 'members') return
      prefetchQueryOnIntent(queryClient, organizationDetailQueryOptions(organizationId))
      prefetchQueryOnIntent(queryClient, organizationRosterQueryOptions(organizationId))
      if (organization.viewer.isAdmin) {
        prefetchQueryOnIntent(queryClient, organizationPlanSeatsOptions(organizationId))
      }
    },
  }
}
