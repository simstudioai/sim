import { useQuery } from '@tanstack/react-query'
import type { StatusResponse } from '@/app/api/status/types'

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
async function fetchStatus(): Promise<StatusResponse> {
  const response = await fetch('/api/status')

  if (!response.ok) {
    throw new Error('Failed to fetch status')
  }

  return response.json()
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
    queryFn: fetchStatus,
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 60 * 1000, // Poll every 60 seconds
    refetchOnWindowFocus: true, // Refetch when user returns to tab
    retry: 2,
  })
}
