'use client'

import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { canReadMemberIntegrations } from '@/lib/credential-groups/member-integrations'
import { simLinksSortParams } from '@/app/o/[organizationId]/links/search-params'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { organizationAccountsQueryOptions } from '@/hooks/queries/organization-accounts'
import { searchIntegrationsQueryOptions } from '@/hooks/queries/search-integrations'
import { simLinksQueryOptions } from '@/hooks/queries/sim-links'
import {
  dropFailedSpeculativeQuery,
  prefetchQueryOnIntent,
} from '@/hooks/queries/utils/prefetch-query-on-intent'

const NAV_WARM_DWELL_MS = 80

/**
 * Reads a nav row's page ahead of an intended open, through the options its hooks read, so the keys
 * and payloads are the same ones. Only the cheap database reads: slow provider reads stay on the page.
 */
export function useNavWarmers() {
  const context = useOrganizationContext()
  const organizationId = context.organization.id
  const queryClient = useQueryClient()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function cancel() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  useEffect(() => cancel, [])

  function warm(destination: string) {
    if (destination === 'integrations' && canReadMemberIntegrations(context)) {
      prefetchQueryOnIntent(queryClient, organizationAccountsQueryOptions(organizationId))
      prefetchQueryOnIntent(queryClient, searchIntegrationsQueryOptions(organizationId))
    }
    if (destination === 'sim-links') {
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
  }
}
