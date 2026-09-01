import { useQuery } from '@tanstack/react-query'
import { fetchStatusPageSummary } from '@/lib/status-page'

export const STATUS_PAGE_POLL_INTERVAL = 60 * 1000
export const STATUS_PAGE_STALE_TIME = 30 * 1000

export const statusPageKeys = {
  all: ['status-page'] as const,
  summaries: () => [...statusPageKeys.all, 'summary'] as const,
  summary: () => [...statusPageKeys.summaries(), 'sim'] as const,
}

interface UseStatusPageOptions {
  enabled?: boolean
}

/** Polls Sim's public status while a hosted workspace is open. */
export function useStatusPage({ enabled = true }: UseStatusPageOptions = {}) {
  return useQuery({
    queryKey: statusPageKeys.summary(),
    queryFn: ({ signal }) => fetchStatusPageSummary(signal),
    enabled,
    staleTime: STATUS_PAGE_STALE_TIME,
    refetchInterval: STATUS_PAGE_POLL_INTERVAL,
    refetchOnWindowFocus: true,
    retry: false,
  })
}
