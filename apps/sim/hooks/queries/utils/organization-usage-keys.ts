import type {
  UsageBreakdownDimension,
  UsageWindowPreset,
} from '@/lib/api/contracts/organization-usage'

/**
 * Query keys for organization usage.
 *
 * Not a `'use client'` module: a key factory imported by a server-evaluated
 * prefetch would become a client reference and throw when called.
 *
 * The keys nest under `['organizations', 'detail', orgId]` deliberately, so the
 * existing `invalidateQueries({ queryKey: organizationKeys.detail(orgId) })` calls —
 * after a member's credit limit changes, for instance — sweep usage too.
 */

export interface OrganizationUsageWindowKey {
  preset: UsageWindowPreset
  startDate?: string
  endDate?: string
  timezone: string
}

export const organizationUsageKeys = {
  all: (organizationId: string) => ['organizations', 'detail', organizationId, 'usage'] as const,
  summary: (
    organizationId: string,
    window: OrganizationUsageWindowKey,
    /** Set only inside the Workspaces drill-down, whose chart reads one workspace. */
    workspaceId?: string
  ) =>
    [...organizationUsageKeys.all(organizationId), 'summary', window, workspaceId ?? ''] as const,
  breakdowns: (organizationId: string, window: OrganizationUsageWindowKey) =>
    [...organizationUsageKeys.all(organizationId), 'breakdown', window] as const,
  breakdown: (
    organizationId: string,
    window: OrganizationUsageWindowKey,
    dimension: UsageBreakdownDimension,
    limit: number,
    workspaceId?: string
  ) =>
    [
      ...organizationUsageKeys.breakdowns(organizationId, window),
      dimension,
      workspaceId ?? '',
      /*
        Last deliberately: it is the one segment the breakdown's `placeholderData`
        ignores, so the list's identity is a plain prefix rather than an index-based
        filter that would silently drop `workspaceId` if a segment were ever appended.
        It also lets an invalidation target one dimension and workspace across every
        row limit.
      */
      limit,
    ] as const,
  events: (organizationId: string, window: OrganizationUsageWindowKey, sources: string[]) =>
    [...organizationUsageKeys.all(organizationId), 'events', window, sources] as const,
}
