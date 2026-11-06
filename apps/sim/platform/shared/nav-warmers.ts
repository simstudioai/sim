'use client'

import { useEffect, useRef } from 'react'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { simLinksSortParams } from '@/lib/sim-links/search-params'
import { organizationAccountsQueryOptions } from '@/hooks/queries/organization-accounts'
import { peopleListQueryOptions } from '@/hooks/queries/people'
import { searchIntegrationsQueryOptions } from '@/hooks/queries/search-integrations'
import { simLinksQueryOptions } from '@/hooks/queries/sim-links'
import {
  dropFailedSpeculativeQuery,
  prefetchQueryOnIntent,
} from '@/hooks/queries/utils/prefetch-query-on-intent'

const NAV_WARM_DWELL_MS = 80

type WarmedSettingsSection = 'general' | 'members'

/** What a surface knows about its viewer and routes. */
interface NavWarmerHost {
  organizationId: string
  isAdmin: boolean
  canReadIntegrations: boolean
  /** The destination id of Sim links on this surface, absent where they are not offered. */
  simLinksDestination?: string
  settingsHref: (section: WarmedSettingsSection) => string
  warmSettingsSection: (queryClient: QueryClient, section: WarmedSettingsSection) => void
}

/**
 * Reads a nav row's page ahead of an intended open, through the options its hooks read, so the keys
 * and payloads are the same ones. Only the cheap database reads: slow provider reads stay on the page.
 */
export function useNavWarmers(host: NavWarmerHost) {
  const { organizationId } = host
  const queryClient = useQueryClient()
  const router = useRouter()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function cancel() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  useEffect(() => cancel, [])

  function warm(destination: string) {
    if (destination === 'integrations' && host.canReadIntegrations) {
      prefetchQueryOnIntent(queryClient, organizationAccountsQueryOptions(organizationId))
      prefetchQueryOnIntent(queryClient, searchIntegrationsQueryOptions(organizationId))
    }
    if (destination === 'people' && host.isAdmin) {
      const options = peopleListQueryOptions(organizationId, '', '', { scope: 'roots' })
      void queryClient
        .prefetchInfiniteQuery(options)
        .then(() => dropFailedSpeculativeQuery(queryClient, options.queryKey))
    }
    if (destination === host.simLinksDestination) {
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
    warmSettings(section: WarmedSettingsSection) {
      router.prefetch(host.settingsHref(section))
      host.warmSettingsSection(queryClient, section)
    },
  }
}
