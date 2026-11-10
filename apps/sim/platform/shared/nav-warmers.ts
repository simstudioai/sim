'use client'

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { organizationAccountsQueryOptions } from '@/hooks/queries/organization-accounts'
import { peopleListQueryOptions } from '@/hooks/queries/people'
import { searchIntegrationsQueryOptions } from '@/hooks/queries/search-integrations'
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
  settingsHref: (section: WarmedSettingsSection) => string
  warmSettingsSection: (queryClient: QueryClient, section: WarmedSettingsSection) => void
}

/**
 * Reads a nav row's page ahead of an intended open, through the options its hooks read, so the keys
 * and payloads are the same ones. Only the cheap database reads: slow provider reads stay on the page.
 */
export function useNavWarmers(host: NavWarmerHost) {
  const queryClient = useQueryClient()
  const router = useRouter()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The warmers keep one identity for the shell's context; each warm reads the host as it fires.
  const latestHost = useRef(host)
  useLayoutEffect(() => {
    latestHost.current = host
  })

  const warmers = useMemo(() => {
    function cancel() {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
    }

    function warm(destination: string) {
      const { organizationId, canReadIntegrations, isAdmin } = latestHost.current
      if (destination === 'integrations' && canReadIntegrations) {
        prefetchQueryOnIntent(queryClient, organizationAccountsQueryOptions(organizationId))
        prefetchQueryOnIntent(queryClient, searchIntegrationsQueryOptions(organizationId))
      }
      if (destination === 'people' && isAdmin) {
        const options = peopleListQueryOptions(organizationId, '', '', { scope: 'roots' })
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
        router.prefetch(latestHost.current.settingsHref(section))
        latestHost.current.warmSettingsSection(queryClient, section)
      },
    }
  }, [queryClient, router])

  useEffect(() => warmers.cancel, [warmers])

  return warmers
}
