'use client'

import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { getAllowedProvidersContract } from '@/lib/api/contracts'

/**
 * Query key factory for allowed providers queries
 */
export const allowedProvidersKeys = {
  all: ['allowedProviders'] as const,
  blacklisted: () => [...allowedProvidersKeys.all, 'blacklisted'] as const,
}

export const BLACKLISTED_PROVIDERS_STALE_TIME = 5 * 60 * 1000

/**
 * Hook to fetch the list of blacklisted provider IDs from the server.
 */
export function useBlacklistedProviders() {
  return useQuery({
    queryKey: allowedProvidersKeys.blacklisted(),
    queryFn: ({ signal }) => requestJson(getAllowedProvidersContract, { signal }),
    staleTime: BLACKLISTED_PROVIDERS_STALE_TIME,
  })
}
