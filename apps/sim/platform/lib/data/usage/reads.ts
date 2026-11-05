'use client'

import { useMemo } from 'react'
import { createLogger } from '@sim/logger'
import { formatDateTime, formatDuration } from '@sim/utils/formatting'
import { isApiClientError } from '@/lib/api/client/errors'
import {
  MAX_CUSTOM_RANGE_DAYS,
  ORGANIZATION_USAGE_OVERVIEW_ROW_LIMIT,
  type OrganizationUsageBreakdown,
  type OrganizationUsageCalendar,
  type OrganizationUsageOverview,
  USAGE_WINDOW_PRESETS,
  type UsageBreakdownDimension,
} from '@/lib/api/contracts/organization-usage'
import {
  ACTIVITY_MAX_PAGE,
  type ActivityDimension,
  type ActivitySort,
} from '@/lib/billing/core/organization-activity'
import { formatApportionedCreditCost } from '@/lib/billing/credits/conversion'
import { saveBlob } from '@/lib/uploads/client/download'
import {
  ACTIVITY_DIMENSION_OPTIONS,
  ACTIVITY_SORT_OPTIONS,
  COLLAPSED_ROW_COUNT,
  EXPANDED_ROW_COUNT,
  PERIOD_LABELS,
  USAGE_OVERVIEW_TAB,
  USAGE_SECTION_LABELS,
  USAGE_SOURCE_CATEGORIES,
  USAGE_TAB_EMPTY_COPY,
  USAGE_TAB_LABELS,
  USAGE_TAB_ORDER,
  type UsageTab,
} from '@/ee/organization-usage/constants'
import {
  foldUsageSeries,
  formatFailureRate,
  formatUsageDelta,
  truncateBreakdown,
  usageEventLabel,
  usageHeatLevel,
} from '@/ee/organization-usage/format'
import { useUsageWindow } from '@/ee/organization-usage/hooks/use-usage-window'
import { serializeOrganizationUsageParams } from '@/ee/organization-usage/search-params'
import {
  useOrganizationActivityBreakdown,
  useOrganizationActivitySummary,
} from '@/hooks/queries/organization-activity'
import {
  useOrganizationUsageBreakdown,
  useOrganizationUsageCalendar,
  useOrganizationUsageEvents,
  useOrganizationUsageOverview,
} from '@/hooks/queries/organization-usage'
import type { OrganizationUsageWindowKey } from '@/hooks/queries/utils/organization-usage-keys'
import { toast } from '@/platform/lib/data/toast'
import { DAY_MS, formatCalendarDate } from '@/platform/lib/time'

const logger = createLogger('PlatformUsage')

export const USAGE_TABS = USAGE_TAB_ORDER.map((tab) => ({
  value: tab,
  label: USAGE_TAB_LABELS[tab],
}))

const PERIOD_OPTIONS = USAGE_WINDOW_PRESETS.map((preset) => PERIOD_LABELS[preset])

export const ACTIVITY_DIMENSIONS = ACTIVITY_DIMENSION_OPTIONS
export const ACTIVITY_SORTS = ACTIVITY_SORT_OPTIONS

export const OVERVIEW_TAB = USAGE_OVERVIEW_TAB
export const SECTION_LABELS = USAGE_SECTION_LABELS
export const EMPTY_COPY = USAGE_TAB_EMPTY_COPY

/** A bucket's timestamp is a wall-clock time in the viewer's zone, so its date is already theirs. */
function dayLabel(timestamp: string): string {
  return formatCalendarDate(timestamp.slice(0, 10))
}

export function formatDurationMs(ms: number | null): string {
  if (ms === null) return '—'
  return ms === 0 ? '0 ms' : (formatDuration(ms, { precision: 2 }) ?? '—')
}

/** The window, tab and drill-down the URL holds, in the legacy page's keys. */
export function useUsageView() {
  const view = useUsageWindow()
  const { setState } = view
  return {
    ...view,
    periodOptions: PERIOD_OPTIONS,
    selectTab: (tab: UsageTab) =>
      void setState({ tab, workspace: null, expanded: null, activityPage: 0 }),
    /** Whether the viewer chose a custom range, which has no dates until they pick some. */
    selectPeriod: (label: string): boolean => {
      const next = USAGE_WINDOW_PRESETS.find((item) => PERIOD_LABELS[item] === label)
      if (!next || next === 'custom') return next === 'custom'
      void setState({ preset: next, startDate: null, endDate: null, activityPage: 0 })
      return false
    },
    applyRange: (start: string, end: string) => {
      const days = Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / DAY_MS) + 1
      if (days > MAX_CUSTOM_RANGE_DAYS) {
        toast.error(`Select a range of ${MAX_CUSTOM_RANGE_DAYS} days or fewer`)
        return false
      }
      void setState({ preset: 'custom', startDate: start, endDate: end, activityPage: 0 })
      return true
    },
    currentPeriod: PERIOD_LABELS[view.preset],
  }
}

/** A credit overview's headline and layers. A failed refresh draws nothing from its stale data. */
function toCreditChart(overview: OrganizationUsageOverview | undefined, failed: boolean) {
  const current = failed ? undefined : overview
  const series = current?.series ?? []
  const present = new Map(foldUsageSeries(series).map((layer) => [layer.category.id, layer.values]))
  const used = current?.totals.credits ?? 0
  const previous = current?.previousTotals?.credits ?? 0
  const limit = current?.limitCredits ?? null
  /** Rounded once, so the arrow and the figure never disagree about a sub-percent change. */
  const delta = current && previous > 0 ? Math.round(((used - previous) / previous) * 100) : null
  return {
    loaded: Boolean(current),
    used,
    deltaLabel: delta === null ? null : formatUsageDelta(delta),
    deltaRose: delta !== null && delta > 0,
    limit,
    overLimit: limit !== null && used > limit,
    limitPercent: limit ? Math.round((used / limit) * 100) : 0,
    series: USAGE_SOURCE_CATEGORIES.map((category) => category.label),
    bars: series.map((point, index) => ({
      label: dayLabel(point.timestamp),
      values: USAGE_SOURCE_CATEGORIES.map((category) => present.get(category.id)?.[index] ?? 0),
    })),
  }
}

export function useUsageOverview(
  organizationId: string,
  window: OrganizationUsageWindowKey,
  options: { enabled: boolean; workspaceId?: string }
) {
  const query = useOrganizationUsageOverview(organizationId, window, options)
  const chart = useMemo(() => toCreditChart(query.data, query.isError), [query.data, query.isError])
  return {
    data: query.data,
    loading: query.isLoading,
    failed: query.isError,
    dimmed: query.isPlaceholderData,
    retry: () => void query.refetch(),
    chart,
  }
}

/** One ranked list. `expanded` asks the API for its ceiling of rows. */
export function useUsageBreakdown(
  organizationId: string,
  window: OrganizationUsageWindowKey,
  dimension: UsageBreakdownDimension,
  options: { enabled: boolean; expanded?: boolean; workspaceId?: string }
) {
  const query = useOrganizationUsageBreakdown(organizationId, window, dimension, {
    enabled: options.enabled,
    limit: options.expanded ? EXPANDED_ROW_COUNT : COLLAPSED_ROW_COUNT,
    workspaceId: options.workspaceId,
  })
  return {
    data: query.data,
    loading: query.isLoading,
    failed: query.isError,
    dimmed: query.isPlaceholderData,
    retry: () => void query.refetch(),
  }
}

export type UsageList = ReturnType<typeof useUsageBreakdown>

export function topRows(breakdown: OrganizationUsageBreakdown | undefined) {
  return breakdown && truncateBreakdown(breakdown, ORGANIZATION_USAGE_OVERVIEW_ROW_LIMIT)
}

export type UsageCalendarDay = OrganizationUsageCalendar['days'][number]

export function useUsageCalendar(organizationId: string, timezone: string, workspaceId?: string) {
  const calendar = useOrganizationUsageCalendar(organizationId, timezone, workspaceId)
  return {
    days: calendar.data?.days,
    failed: calendar.isError,
    retry: () => void calendar.refetch(),
  }
}

function formatDayUsage(day: UsageCalendarDay): string {
  return `${formatApportionedCreditCost(day.credits, day.hasCost)} on ${formatCalendarDate(day.date, 'weekday')}`
}

/** The grid for a year of days, weeks across and Monday first. */
export function layoutUsageCalendar(days: readonly UsageCalendarDay[]) {
  const first = days[0]
  const offset = first ? (new Date(`${first.date}T00:00:00Z`).getUTCDay() + 6) % 7 : 0
  const weeks = Math.ceil((offset + days.length) / 7)
  const peak = Math.max(...days.map((day) => day.credits), 1)
  return {
    weeks,
    total: formatYearUsage(days),
    months: days.flatMap((day, index) => {
      if (!day.date.endsWith('-01')) return []
      const column = Math.floor((index + offset) / 7)
      return column > weeks - 3
        ? []
        : [{ date: day.date, column, label: formatCalendarDate(day.date).split(' ')[0] }]
    }),
    cells: days.map((day, index) => ({
      date: day.date,
      column: Math.floor((index + offset) / 7),
      row: (index + offset) % 7,
      level: usageHeatLevel(day.credits, peak, day.hasCost),
      label: formatDayUsage(day),
    })),
  }
}

function formatYearUsage(days: readonly UsageCalendarDay[]): string {
  const total = days.reduce((sum, day) => sum + day.credits, 0)
  return `${formatApportionedCreditCost(
    total,
    days.some((day) => day.hasCost)
  )} in the last 365 days`
}

export function useActivitySummary(
  organizationId: string,
  window: OrganizationUsageWindowKey,
  workspaceId?: string
) {
  const query = useOrganizationActivitySummary(organizationId, window, { workspaceId })
  const totals = query.data?.totals
  const failed = query.isError
  const { outcomeBars, chatPoints } = useMemo(() => {
    const series = query.data?.series ?? []
    return {
      outcomeBars: series.map((point) => ({
        label: dayLabel(point.timestamp),
        values: [
          point.completed,
          point.failed,
          Math.max(0, point.workflowRuns - point.completed - point.failed),
        ],
      })),
      chatPoints: series.map((point) => ({
        label: dayLabel(point.timestamp),
        value: point.chatRuns,
      })),
    }
  }, [query.data])
  return {
    pending: query.isPending,
    failed,
    retry: () => void query.refetch(),
    unavailable: isApiClientError(query.error) && query.error.status === 404,
    workspaceName: query.data?.workspace?.name,
    metrics: [
      { label: 'Workflow runs', value: totals?.workflowRuns.toLocaleString() ?? '—' },
      { label: 'Chat runs', value: totals?.chatRuns.toLocaleString() ?? '—' },
      { label: 'Chat members', value: totals?.chatMembers.toLocaleString() ?? '—' },
      { label: 'Failure rate', value: formatFailureRate(totals?.failureRate ?? null) },
      {
        label: 'Avg. duration',
        value: formatDurationMs(totals?.averageDurationMs ?? null),
      },
    ],
    outcomeSeries: ['Completed', 'Failed', 'Other'],
    outcomeBars,
    chatPoints,
  }
}

export function useActivityBreakdown(
  organizationId: string,
  window: OrganizationUsageWindowKey,
  dimension: ActivityDimension,
  sort: ActivitySort,
  page: number,
  workspaceId?: string
) {
  const query = useOrganizationActivityBreakdown(organizationId, window, dimension, sort, page, {
    workspaceId,
  })
  const rows = useMemo(
    () =>
      query.data?.rows.map((row) => ({
        ...row,
        failureRateLabel: formatFailureRate(row.failureRate),
      })),
    [query.data]
  )
  return {
    rows,
    hasMore: Boolean(query.data?.hasMore),
    failed: query.isError,
    loading: query.isLoading,
    retry: () => void query.refetch(),
    maxPage: ACTIVITY_MAX_PAGE,
  }
}

export function useUsageEvents(organizationId: string, window: OrganizationUsageWindowKey) {
  const events = useOrganizationUsageEvents(organizationId, window)
  return {
    pending: events.isLoading,
    failed: events.isError,
    dimmed: events.isPlaceholderData,
    retry: () => void events.refetch(),
    rows: (events.data?.pages.flatMap((page) => page.events) ?? []).map((event) => ({
      id: event.id,
      when: formatDateTime(new Date(event.createdAt)),
      label: usageEventLabel(event),
      description: event.description,
      credits: formatApportionedCreditCost(event.credits, event.hasCost),
    })),
    loadMore: {
      hasMore: events.hasNextPage && !events.isPlaceholderData,
      loading: events.isFetchingNextPage,
      error: events.isFetchNextPageError ? 'Failed to load more usage events' : undefined,
      onLoadMore: () => void events.fetchNextPage(),
    },
  }
}

/** The link to the events ledger, keeping the current window. */
export function usageEventsHref(window: OrganizationUsageWindowKey): string {
  return serializeOrganizationUsageParams('/settings/usage/events', {
    preset: window.preset,
    startDate: window.startDate ?? null,
    endDate: window.endDate ?? null,
  })
}

/** The audit log for one workspace; the same key `ee/audit-logs/search-params` parses. */
export function workspaceAuditLogsHref(workspaceId: string): string {
  return `/settings/audit-logs?${new URLSearchParams({ workspace: workspaceId })}`
}

/**
 * Downloads the window's CSV. Reads `X-Export-Truncated` before saving, which a plain anchor
 * navigation cannot do.
 */
export async function exportUsageCsv(
  organizationId: string,
  window: OrganizationUsageWindowKey
): Promise<void> {
  const params = new URLSearchParams({ preset: window.preset, timezone: window.timezone })
  if (window.startDate) params.set('startDate', window.startDate)
  if (window.endDate) params.set('endDate', window.endDate)
  try {
    // boundary-raw-fetch: downloads a CSV blob and reads X-Export-Truncated before saving, which a plain anchor navigation can do neither of
    const response = await fetch(`/api/organizations/${organizationId}/usage/export?${params}`)
    if (!response.ok) {
      toast.error('Failed to export usage')
      return
    }
    if (response.headers.get('X-Export-Truncated') === '1') {
      toast.info('Export truncated: narrow the date range to see everything')
    }
    saveBlob(
      await response.blob(),
      `organization-usage-${new Date().toISOString().slice(0, 10)}.csv`
    )
  } catch (error) {
    logger.error('Failed to export usage', { error })
    toast.error('Failed to export usage')
  }
}
