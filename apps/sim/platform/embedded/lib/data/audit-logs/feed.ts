'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import { hashKey, useQueryClient } from '@tanstack/react-query'
import { useQueryStates } from 'nuqs'
import { downloadCsvExport } from '@/lib/core/utils/csv-download'
import { getEndDateFromTimeRange, getStartDateFromTimeRange } from '@/lib/logs/time-range'
import { SEARCH_DEBOUNCE_MS } from '@/lib/url-state/constants'
import { useOrganizationWorkspaces } from '@/ee/access-control/hooks/permission-groups'
import {
  type AuditLogFilters,
  auditLogsInfiniteOptions,
  useAuditLogs,
} from '@/ee/audit-logs/hooks/audit-logs'
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
import { useSearchFilterValue } from '@/hooks/use-search-filter-value'
import { useSettingsSearch } from '@/hooks/use-settings-search'
import { currentMinute } from '@/platform/lib/time'
import type { TimeRange } from '@/stores/logs/filters/types'

const logger = createLogger('AuditLogFeed')

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
  const workspaceScope = urlFilters.workspace
  const workspaces = useOrganizationWorkspaces(organizationId, Boolean(workspaceScope))
  const scope = resolveAuditWorkspaceScope(workspaceScope, workspaces)
  const [search, setSearch] = useSettingsSearch()
  const debouncedSearch = useSearchFilterValue(search, SEARCH_DEBOUNCE_MS).trim()

  /**
   * What a preset's window is measured from. It is part of the query key, so it holds still while
   * the viewer reads: loaded pages stay loaded and an export covers the rows on screen. A new set of
   * filters takes a new anchor, and Refresh moves it once the new window has answered.
   */
  const filterIdentity = hashKey([
    timeRange,
    customStart,
    customEnd,
    debouncedSearch,
    urlFilters.types,
    workspaceScope,
  ])
  const queryClient = useQueryClient()
  const [held, setHeld] = useState(() => ({
    filterIdentity,
    anchor: currentMinute(),
  }))
  if (held.filterIdentity !== filterIdentity) {
    setHeld({ filterIdentity, anchor: currentMinute() })
  }
  const filtersFrom = (anchor: number): AuditLogFilters => ({
    search: debouncedSearch || undefined,
    resourceType: urlFilters.types.length > 0 ? urlFilters.types.join(',') : undefined,
    workspaceId: scope.workspace?.id,
    startDate: getStartDateFromTimeRange(timeRange, customStart, anchor)?.toISOString(),
    endDate: getEndDateFromTimeRange(timeRange, customEnd)?.toISOString(),
  })
  const filters = filtersFrom(held.anchor)
  const feed = useAuditLogs(organizationId, filters, scope.feedEnabled)

  /** The rows on screen stay until the moved window answers, and stay if it cannot. */
  const refreshFeed = async () => {
    const anchor = currentMinute()
    const moved = filtersFrom(anchor)
    if (moved.startDate === filters.startDate) {
      await feed.refetch()
      return
    }
    try {
      await queryClient.fetchInfiniteQuery(auditLogsInfiniteOptions(organizationId, moved))
    } catch (error) {
      logger.error('Failed to refresh audit logs', { error })
      return
    }
    setHeld((latest) => (latest.filterIdentity === filterIdentity ? { ...latest, anchor } : latest))
  }

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
        ...(reads.feed ? [refreshFeed()] : []),
        ...(reads.workspaces ? [workspaces.refetch()] : []),
      ])
    },
    exportCsv: () =>
      downloadCsvExport(
        auditLogExportUrl(organizationId, filters),
        `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
      ),
  }
}
