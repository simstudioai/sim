'use client'

import { useMemo } from 'react'
import { useQueryStates } from 'nuqs'
import { downloadCsvExport } from '@/lib/core/utils/csv-download'
import { getEndDateFromTimeRange, getStartDateFromTimeRange } from '@/lib/logs/time-range'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state/constants'
import { useOrganizationWorkspaces } from '@/ee/access-control/hooks/permission-groups'
import { type AuditLogFilters, useAuditLogs } from '@/ee/audit-logs/hooks/audit-logs'
import { auditLogExportUrl } from '@/ee/audit-logs/lib/format'
import {
  auditRefreshReads,
  presentableAuditEntries,
  resolveAuditTimeRange,
  resolveAuditWorkspaceScope,
} from '@/ee/audit-logs/lib/scope'
import {
  auditLogFilterParsers,
  auditLogFilterUrlKeys,
  DEFAULT_AUDIT_TIME_RANGE,
} from '@/ee/audit-logs/search-params'
import { useDebounce } from '@/hooks/use-debounce'
import { useSettingsSearch } from '@/hooks/use-settings-search'
import { useFixtureSettingsActions } from '@/platform/lib/data/settings-providers'
import type { TimeRange } from '@/stores/logs/filters/types'

/**
 * The audit feed under the URL's filters and deep-linked workspace scope. The scope is resolved
 * before anything reads: an unanswerable scope presents no rows and refreshes nothing organization
 * wide, because the feed's own filter carries no workspace until the scope resolves.
 */
export function useAuditLogFeed(organizationId: string) {
  const [urlFilters, setUrlFilters] = useQueryStates(auditLogFilterParsers, auditLogFilterUrlKeys)
  const { timeRange, customStart, customEnd } = resolveAuditTimeRange(
    urlFilters,
    DEFAULT_AUDIT_TIME_RANGE
  )
  const referenceTime = useFixtureSettingsActions()?.referenceTime
  const workspaceScope = urlFilters.workspace
  const workspaces = useOrganizationWorkspaces(organizationId, Boolean(workspaceScope))
  const scope = resolveAuditWorkspaceScope(workspaceScope, workspaces)
  const [search, setSearch] = useSettingsSearch()
  const debouncedSearch = useDebounce(search, SEARCH_DEBOUNCE_MS).trim()

  /** A preset's start reads the clock, so it is pinned per range or every render would be a new key. */
  const startDate = useMemo(
    () => getStartDateFromTimeRange(timeRange, customStart, referenceTime)?.toISOString(),
    [timeRange, customStart, referenceTime]
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
    nextPageError: feed.isFetchNextPageError
      ? (feed.error?.message ?? 'Failed to load more audit logs')
      : undefined,
    fetchNextPage: () => void feed.fetchNextPage(),
    setTypes: (types: string[]) => void setUrlFilters({ types }),
    clearWorkspaceScope: () => void setUrlFilters({ workspace: null }),
    selectPreset: (value: TimeRange) =>
      void setUrlFilters({ timeRange: value, startDate: null, endDate: null }),
    /** Both bounds are written at once, so the URL never holds a half-open custom range. */
    applyCustomRange: (start: string, end: string) =>
      void setUrlFilters({ timeRange: 'Custom range', startDate: start, endDate: end }),
    /** Reads only what `auditRefreshReads` allows, since `refetch` ignores `enabled`. */
    refresh: async () => {
      const reads = auditRefreshReads(scope, workspaceScope)
      await Promise.all([
        ...(reads.feed ? [feed.refetch()] : []),
        ...(reads.workspaces ? [workspaces.refetch()] : []),
      ])
    },
    exportCsv: () =>
      downloadCsvExport(
        auditLogExportUrl(organizationId, filters),
        `audit-logs-${new Date(referenceTime ?? Date.now()).toISOString().slice(0, 10)}.csv`
      ),
  }
}
