'use client'

import { hashKey, keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getOrganizationUsageBreakdownContract,
  getOrganizationUsageSummaryContract,
  listOrganizationUsageEventsContract,
  ORGANIZATION_USAGE_BREAKDOWN_DEFAULT_LIMIT,
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

/**
 * A usage key with its trailing segment dropped — the identity of the question being
 * asked, which is what `placeholderData` has to compare on.
 *
 * Both keys put the one segment their placeholder may legitimately cross last: the
 * summary's window ("the same scope, a different period") and the breakdown's row limit
 * ("the same list, more rows"). Everything a retained answer must never cross —
 * organization, workspace, dimension — sits in the prefix.
 */
function usageKeyIdentity(key: readonly unknown[]): string {
  return hashKey(key.slice(0, -1))
}

interface UseSummaryOptions {
  /** The panel fetches the drill-down's chart only while that view is open. */
  enabled?: boolean
  /** Narrows to one workspace, for the Workspaces drill-down. */
  workspaceId?: string
}

export function useOrganizationUsageSummary(
  organizationId: string | undefined,
  window: OrganizationUsageWindowKey,
  options: UseSummaryOptions = {}
) {
  const { workspaceId } = options
  const queryKey = organizationUsageKeys.summary(organizationId ?? '', window, workspaceId)
  return useQuery({
    queryKey,
    queryFn: ({ signal }): Promise<OrganizationUsageSummary> =>
      requestJson(getOrganizationUsageSummaryContract, {
        params: { id: organizationId as string },
        query: { ...window, ...(workspaceId ? { workspaceId } : {}) },
        signal,
      }),
    enabled: Boolean(organizationId) && (options.enabled ?? true),
    staleTime: ORGANIZATION_USAGE_SUMMARY_STALE_TIME,
    /**
     * Kept only across a period change — the same scope asked about a different window,
     * where dimming the figures beats blanking them.
     *
     * Not `keepPreviousData`, which retains across *any* key change: once the key
     * carries a workspace, moving between two drill-downs would draw one workspace's
     * headline, delta, and chart under the other's name until the fetch landed. A
     * figure attributed to the wrong workspace is worse than a brief skeleton, and
     * unlike a ranked list it carries nothing that would look out of place.
     */
    placeholderData: (previous, previousQuery) =>
      previous &&
      previousQuery &&
      usageKeyIdentity(previousQuery.queryKey) === usageKeyIdentity(queryKey)
        ? previous
        : undefined,
  })
}

interface UseBreakdownOptions {
  limit?: number
  /** The panel passes the selected tab, so only the visible list is ever fetched. */
  enabled?: boolean
  /** Narrows to one workspace, for the Workspaces drill-down. */
  workspaceId?: string
}

export function useOrganizationUsageBreakdown(
  organizationId: string | undefined,
  window: OrganizationUsageWindowKey,
  dimension: UsageBreakdownDimension,
  options: UseBreakdownOptions = {}
) {
  const limit = options.limit ?? ORGANIZATION_USAGE_BREAKDOWN_DEFAULT_LIMIT
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
      usageKeyIdentity(previousQuery.queryKey) === usageKeyIdentity(queryKey)
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
