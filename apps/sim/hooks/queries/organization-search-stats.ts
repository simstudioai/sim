'use client'

import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type OrganizationSearchStatsQuery,
  readOrganizationSearchStatsContract,
} from '@/lib/api/contracts/knowledge/search-stats'

export const ORGANIZATION_SEARCH_STATS_STALE_TIME = 60_000

export const organizationSearchStatsKeys = {
  all: ['organization-search-stats'] as const,
  summaries: () => [...organizationSearchStatsKeys.all, 'summary'] as const,
  summary: (query: OrganizationSearchStatsQuery) =>
    [...organizationSearchStatsKeys.summaries(), query] as const,
}

export function useOrganizationSearchStats(query: OrganizationSearchStatsQuery) {
  return useQuery({
    queryKey: organizationSearchStatsKeys.summary(query),
    queryFn: async ({ signal }) => {
      const result = await requestJson(readOrganizationSearchStatsContract, { query, signal })
      return result.data
    },
    staleTime: ORGANIZATION_SEARCH_STATS_STALE_TIME,
  })
}
