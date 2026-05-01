import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractJsonResponse } from '@/lib/api/contracts'
import { getStatusContract } from '@/lib/api/contracts'

/**
 * Query key factories for status-related queries
 * This ensures consistent cache invalidation across the app
 */
export const statusKeys = {
  all: ['status'] as const,
  current: () => [...statusKeys.all, 'current'] as const,
}

/**
 * Fetch current system status from the API
 * The API proxies incident.io and caches for 2 minutes server-side
 */
async function fetchStatus(
  signal?: AbortSignal
): Promise<ContractJsonResponse<typeof getStatusContract>> {
  return requestJson(getStatusContract, { signal })
}

/**
 * Hook to fetch current system status
 * - Polls every 60 seconds to keep status up-to-date
 * - Refetches when user returns to tab for immediate updates
 * - Caches for 1 minute to reduce unnecessary requests
 */
export function useStatus() {
  return useQuery({
    queryKey: statusKeys.current(),
    queryFn: ({ signal }) => fetchStatus(signal),
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 60 * 1000, // Poll every 60 seconds
    refetchOnWindowFocus: true, // Refetch when user returns to tab
    retry: 2,
  })
}
