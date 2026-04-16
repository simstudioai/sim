'use client'

import { useQuery } from '@tanstack/react-query'

/**
 * Query key factory for allowed providers queries
 */
export const allowedProvidersKeys = {
  all: ['allowedProviders'] as const,
  blacklisted: () => [...allowedProvidersKeys.all, 'blacklisted'] as const,
}

interface BlacklistedProvidersResponse {
  blacklistedProviders: string[]
}

async function fetchBlacklistedProviders(
  signal: AbortSignal
): Promise<BlacklistedProvidersResponse> {
  const res = await fetch('/api/settings/allowed-providers', { signal })
  if (!res.ok) return { blacklistedProviders: [] }
  return res.json()
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
