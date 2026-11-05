'use client'

import { useMemo } from 'react'
import { useQueryStates } from 'nuqs'
import { downloadCsvExport } from '@/lib/core/utils/csv-download'
import { getEndDateFromTimeRange, getStartDateFromTimeRange } from '@/lib/logs/time-range'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state/constants'
import { useOrganizationWorkspaces } from '@/ee/access-control/hooks/permission-groups'
import { RESOURCE_TYPE_OPTIONS } from '@/ee/audit-logs/constants'
import { type AuditLogFilters, useAuditLogs } from '@/ee/audit-logs/hooks/audit-logs'
import { auditLogExportUrl } from '@/ee/audit-logs/lib/format'
import { presentableAuditEntries, resolveAuditWorkspaceScope } from '@/ee/audit-logs/lib/scope'
import {
  auditLogFilterParsers,
  auditLogFilterUrlKeys,
  DEFAULT_AUDIT_TIME_RANGE,
} from '@/ee/audit-logs/search-params'
import { useDebounce } from '@/hooks/use-debounce'
import { useSettingsSearch } from '@/hooks/use-settings-search'
import type { TimeRange } from '@/stores/logs/filters/types'

export {
  AUDIT_TIME_RANGE_OPTIONS,
  describeMetadataValue,
  formatAuditAction,
  formatMetadataLabel,
  formatResourceType,
  getAuditMetadataEntries,
  isDestructiveAuditAction,
} from '@/ee/audit-logs/lib/format'
export { canExportAuditLogs } from '@/ee/audit-logs/lib/scope'
export { RESOURCE_TYPE_OPTIONS }

/**
 * The audit feed under the URL's filters and deep-linked workspace scope. The scope is resolved
 * before anything reads: an unanswerable scope presents no rows and refreshes nothing organization
 * wide, because the feed's own filter carries no workspace until the scope resolves.
 */
export function useAuditLogFeed(organizationId: string) {
  const [urlFilters, setUrlFilters] = useQueryStates(auditLogFilterParsers, auditLogFilterUrlKeys)
  const customStart = urlFilters.startDate ?? ''
  const customEnd = urlFilters.endDate ?? ''
  /**
   * 'Custom range' is only honored with both bounds present: a partial deep link falls back to the
   * default preset window instead of silently querying unbounded.
   */
  const timeRange: TimeRange =
    urlFilters.timeRange === 'Custom range' && (!customStart || !customEnd)
      ? DEFAULT_AUDIT_TIME_RANGE
      : urlFilters.timeRange
  const workspaceScope = urlFilters.workspace
  const workspaces = useOrganizationWorkspaces(organizationId, Boolean(workspaceScope))
  const scope = resolveAuditWorkspaceScope(workspaceScope, workspaces)
  const [search, setSearch] = useSettingsSearch()
  const debouncedSearch = useDebounce(search, SEARCH_DEBOUNCE_MS).trim()

  /** A preset's start reads the clock, so it is pinned per range or every render would be a new key. */
  const startDate = useMemo(
    () => getStartDateFromTimeRange(timeRange, customStart)?.toISOString(),
    [timeRange, customStart]
  )
  const filters: AuditLogFilters = {
    search: debouncedSearch || undefined,
    resourceType: urlFilters.types.length > 0 ? urlFilters.types.join(',') : undefined,
    workspaceId: scope.workspace?.id,
    startDate,
    endDate: getEndDateFromTimeRange(timeRange, customEnd)?.toISOString(),
  }
  const feed = useAuditLogs(organizationId, filters, scope.feedEnabled)

  return {
    entries: presentableAuditEntries(feed.data?.pages, scope.isAnswerable),
    scope,
    search,
    setSearch,
    debouncedSearch,
    timeRange,
    customRange:
      timeRange === 'Custom range' && customStart && customEnd
        ? { start: customStart, end: customEnd }
        : null,
    types: urlFilters.types,
    workspaceScope,
    isLoading: feed.isLoading || scope.isPending,
    isError: feed.isError && !feed.data,
    errorMessage: feed.error?.message,
    isPlaceholderData: feed.isPlaceholderData,
    hasNextPage: feed.hasNextPage,
    isFetchingNextPage: feed.isFetchingNextPage,
    fetchNextPage: () => void feed.fetchNextPage(),
    setTypes: (types: string[]) => void setUrlFilters({ types }),
    clearWorkspaceScope: () => void setUrlFilters({ workspace: null }),
    selectPreset: (value: TimeRange) =>
      void setUrlFilters({ timeRange: value, startDate: null, endDate: null }),
    /** Both bounds are written at once, so the URL never holds a half-open custom range. */
    applyCustomRange: (start: string, end: string) =>
      void setUrlFilters({ timeRange: 'Custom range', startDate: start, endDate: end }),
    /**
     * `refetch` ignores `enabled`, so this repeats the gate. The lookup is what has to succeed for a
     * closed feed to reopen, so it is retried whenever a scope asked for it.
     */
    refresh: async () => {
      const pending: Promise<unknown>[] = []
      if (scope.isAnswerable) pending.push(feed.refetch())
      if (workspaceScope) pending.push(workspaces.refetch())
      await Promise.all(pending)
    },
    exportCsv: () =>
      downloadCsvExport(
        auditLogExportUrl(organizationId, filters),
        `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
      ),
  }
}
