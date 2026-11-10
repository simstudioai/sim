import { useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  getOrganizationActivityBreakdownContract,
  getOrganizationActivitySummaryContract,
} from '@/lib/api/contracts/organization-activity'
import type { ActivityDimension, ActivitySort } from '@/lib/billing/core/organization-activity'
import {
  type OrganizationUsageWindowKey,
  organizationUsageKeys,
} from '@/hooks/queries/utils/organization-usage-keys'

export const ORGANIZATION_ACTIVITY_STALE_TIME = 60 * 1000

export const organizationActivityKeys = {
  all: (organizationId: string) =>
    [...organizationUsageKeys.all(organizationId), 'activity'] as const,
  summaries: (organizationId: string) =>
    [...organizationActivityKeys.all(organizationId), 'summary'] as const,
  summary: (organizationId: string, window: OrganizationUsageWindowKey, workspaceId?: string) =>
    [...organizationActivityKeys.summaries(organizationId), window, workspaceId ?? ''] as const,
  breakdowns: (organizationId: string) =>
    [...organizationActivityKeys.all(organizationId), 'breakdown'] as const,
  breakdown: (
    organizationId: string,
    window: OrganizationUsageWindowKey,
    dimension: ActivityDimension,
    sort: ActivitySort,
    page: number,
    workspaceId?: string
  ) =>
    [
      ...organizationActivityKeys.breakdowns(organizationId),
      window,
      workspaceId ?? '',
      dimension,
      sort,
      page,
    ] as const,
}

interface ActivityQueryOptions {
  enabled?: boolean
  workspaceId?: string
}

export function useOrganizationActivitySummary(
  organizationId: string,
  window: OrganizationUsageWindowKey,
  { enabled = true, workspaceId }: ActivityQueryOptions = {}
) {
  return useQuery({
    queryKey: organizationActivityKeys.summary(organizationId, window, workspaceId),
    queryFn: ({ signal }) =>
      requestJson(getOrganizationActivitySummaryContract, {
        params: { id: organizationId },
        query: { ...window, workspaceId },
        signal,
      }),
    enabled: Boolean(organizationId) && enabled,
    staleTime: ORGANIZATION_ACTIVITY_STALE_TIME,
  })
}

export function useOrganizationActivityBreakdown(
  organizationId: string,
  window: OrganizationUsageWindowKey,
  dimension: ActivityDimension,
  sort: ActivitySort,
  page: number,
  { enabled = true, workspaceId }: ActivityQueryOptions = {}
) {
  return useQuery({
    queryKey: organizationActivityKeys.breakdown(
      organizationId,
      window,
      dimension,
      sort,
      page,
      workspaceId
    ),
    queryFn: ({ signal }) =>
      requestJson(getOrganizationActivityBreakdownContract, {
        params: { id: organizationId },
        query: { ...window, workspaceId, dimension, sort, page },
        signal,
      }),
    enabled: Boolean(organizationId) && enabled,
    staleTime: ORGANIZATION_ACTIVITY_STALE_TIME,
  })
}
