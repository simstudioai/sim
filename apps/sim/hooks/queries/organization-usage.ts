'use client'

import { hashKey, keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getOrganizationUsageBreakdownContract,
  getOrganizationUsageSummaryContract,
  listOrganizationUsageEventsContract,
  type OrganizationUsageBreakdown,
  type OrganizationUsageEventPage,
  type OrganizationUsageSummary,
  type UsageBreakdownDimension,
} from '@/lib/api/contracts/organization-usage'
import {
  type OrganizationUsageWindowKey,
  organizationUsageKeys,
} from '@/hooks/queries/utils/organization-usage-keys'

export const ORGANIZATION_USAGE_SUMMARY_STALE_TIME = 60 * 1000
/**
 * Longer than the summary: a ranking does not move meaningfully within a minute, and
 * three of the five dimensions heap-scan the ledger.
 */
export const ORGANIZATION_USAGE_BREAKDOWN_STALE_TIME = 5 * 60 * 1000
export const ORGANIZATION_USAGE_EVENTS_STALE_TIME = 30 * 1000

const EVENTS_PAGE_SIZE = 50

export function useOrganizationUsageSummary(
  organizationId: string | undefined,
  window: OrganizationUsageWindowKey
) {
  return useQuery({
    queryKey: organizationUsageKeys.summary(organizationId ?? '', window),
    queryFn: ({ signal }): Promise<OrganizationUsageSummary> =>
      requestJson(getOrganizationUsageSummaryContract, {
        params: { id: organizationId as string },
        query: { ...window },
        signal,
      }),
    enabled: Boolean(organizationId),
    staleTime: ORGANIZATION_USAGE_SUMMARY_STALE_TIME,
    // Changing the period should dim the current figures rather than blank them.
    placeholderData: keepPreviousData,
  })
}

interface UseBreakdownOptions {
  limit?: number
  /** The panel passes the selected tab, so only the visible list is ever fetched. */
  enabled?: boolean
  /** Narrows to one workspace, for the Workspaces drill-down. */
  workspaceId?: string
}

/**
 * A breakdown key with its trailing row limit removed — the identity of the list,
 * which is what "the same list, more rows" has to compare on.
 */
function breakdownListIdentity(key: readonly unknown[]): string {
  return hashKey(key.slice(0, -1))
}

export function useOrganizationUsageBreakdown(
  organizationId: string | undefined,
  window: OrganizationUsageWindowKey,
  dimension: UsageBreakdownDimension,
  options: UseBreakdownOptions = {}
) {
  const limit = options.limit ?? 10
  const { workspaceId } = options
  const queryKey = organizationUsageKeys.breakdown(
    organizationId ?? '',
    window,
    dimension,
    limit,
    workspaceId
  )
  return useQuery({
    queryKey,
    queryFn: ({ signal }): Promise<OrganizationUsageBreakdown> =>
      requestJson(getOrganizationUsageBreakdownContract, {
        params: { id: organizationId as string },
        query: {
          ...window,
          dimension,
          limit,
          ...(workspaceId ? { workspaceId } : {}),
        },
        signal,
      }),
    enabled: Boolean(organizationId) && (options.enabled ?? true),
    staleTime: ORGANIZATION_USAGE_BREAKDOWN_STALE_TIME,
    /**
     * Kept only across a row-limit change — opening the `Other` row asks the same
     * question of the same list, and the visible rows are a prefix of the answer, so
     * dimming beats blanking. Any other key change (dimension, window, workspace)
     * would put a stale ranking under a new label, which reads as wrong data and is
     * worse than a brief skeleton.
     */
    placeholderData: (previous, previousQuery) =>
      previous &&
      previousQuery &&
      breakdownListIdentity(previousQuery.queryKey) === breakdownListIdentity(queryKey)
        ? previous
        : undefined,
  })
}

export function useOrganizationUsageEvents(
  organizationId: string | undefined,
  window: OrganizationUsageWindowKey,
  sources: string[] = []
) {
  return useInfiniteQuery({
    queryKey: organizationUsageKeys.events(organizationId ?? '', window, sources),
    queryFn: ({ pageParam, signal }): Promise<OrganizationUsageEventPage> =>
      requestJson(listOrganizationUsageEventsContract, {
        params: { id: organizationId as string },
        query: {
          ...window,
          ...(sources.length ? { source: sources } : {}),
          limit: EVENTS_PAGE_SIZE,
          cursor: pageParam,
        },
        signal,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(organizationId),
    staleTime: ORGANIZATION_USAGE_EVENTS_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}
