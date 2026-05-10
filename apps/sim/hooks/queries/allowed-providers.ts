'use client'

import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractJsonResponse } from '@/lib/api/contracts'
import { getAllowedProvidersContract } from '@/lib/api/contracts'

/**
 * Query key factory for allowed providers queries
 */
export const allowedProvidersKeys = {
  all: ['allowedProviders'] as const,
  blacklisted: () => [...allowedProvidersKeys.all, 'blacklisted'] as const,
}

type BlacklistedProvidersResponse = ContractJsonResponse<typeof getAllowedProvidersContract>

async function fetchBlacklistedProviders(
  signal: AbortSignal
): Promise<BlacklistedProvidersResponse> {
  try {
    return await requestJson(getAllowedProvidersContract, { signal })
  } catch {
    return { blacklistedProviders: [] }
  }
}

/**
 * Hook to fetch the list of blacklisted provider IDs from the server.
 */
export function useBlacklistedProviders({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: allowedProvidersKeys.blacklisted(),
    queryFn: ({ signal }) => fetchBlacklistedProviders(signal),
    staleTime: 5 * 60 * 1000,
    enabled,
  })
}
