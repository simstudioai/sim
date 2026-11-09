'use client'

import { createLogger } from '@sim/logger'
import { formatDateTime } from '@sim/utils/formatting'
import { getOrganizationSettingsHref } from '@/components/settings/navigation'
import { isApiClientError } from '@/lib/api/client/errors'
import {
  MAX_CUSTOM_RANGE_DAYS,
  USAGE_WINDOW_PRESETS,
  type UsageBreakdownDimension,
} from '@/lib/api/contracts/organization-usage'
import {
  ACTIVITY_MAX_PAGE,
  type ActivityDimension,
  type ActivitySort,
} from '@/lib/billing/core/organization-activity'
import { formatApportionedCreditCost } from '@/lib/billing/credits/conversion'
import { useOrganization } from '@/lib/organizations/provider'
import { toast } from '@/lib/toast/sink'
import { saveBlob } from '@/lib/uploads/client/download'
import {
  COLLAPSED_ROW_COUNT,
  EXPANDED_ROW_COUNT,
  PERIOD_LABELS,
  type UsageTab,
} from '@/ee/organization-usage/constants'
import { formatFailureRate, usageEventLabel } from '@/ee/organization-usage/format'
import { useUsageWindow } from '@/ee/organization-usage/hooks/use-usage-window'
import { serializeOrganizationUsageParams } from '@/ee/organization-usage/search-params'
import {
  type MothershipEnv,
  useMothershipLicenses,
  useMothershipRequests,
  useMothershipUserBreakdown,
} from '@/hooks/queries/mothership-admin'
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
import { DAY_MS } from '@/platform/shared/time'
import { dayLabel, formatDurationMs, toCreditChart } from '@/platform/shared/usage'

const logger = createLogger('PlatformUsage')

const PERIOD_OPTIONS = USAGE_WINDOW_PRESETS.map((preset) => PERIOD_LABELS[preset])

/** The window, tab and drill-down the URL holds, in the legacy page's keys. */
export function useUsageView() {
  const view = useUsageWindow()
  const organizationId = useOrganization().organization.id
  const { setState } = view
  return {
    ...view,
    periodOptions: PERIOD_OPTIONS,
    eventsHref: usageWindowHref(
      `${getOrganizationSettingsHref(organizationId, 'usage')}/events`,
      view.window
    ),
    backHref: usageWindowHref(getOrganizationSettingsHref(organizationId, 'usage'), view.window),
    auditLogsHref: (workspaceId: string) =>
      serializeOrganizationUsageParams(getOrganizationSettingsHref(organizationId, 'audit-logs'), {
        workspace: workspaceId,
      }),
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

export function useUsageOverview(
  organizationId: string,
  window: OrganizationUsageWindowKey,
  options: { enabled: boolean; workspaceId?: string }
) {
  const query = useOrganizationUsageOverview(organizationId, window, options)
  const chart = toCreditChart(query.data, query.isError)
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

export function useUsageCalendar(organizationId: string, timezone: string, workspaceId?: string) {
  const calendar = useOrganizationUsageCalendar(organizationId, timezone, workspaceId)
  return {
    days: calendar.data?.days,
    failed: calendar.isError,
    retry: () => void calendar.refetch(),
  }
}

export function useActivitySummary(
  organizationId: string,
  window: OrganizationUsageWindowKey,
  workspaceId?: string
) {
  const query = useOrganizationActivitySummary(organizationId, window, { workspaceId })
  const totals = query.data?.totals
  const failed = query.isError
  const series = query.data?.series ?? []
  const outcomeBars = series.map((point) => ({
    label: dayLabel(point.timestamp),
    values: [
      point.completed,
      point.failed,
      Math.max(0, point.workflowRuns - point.completed - point.failed),
    ],
  }))
  const chatPoints = series.map((point) => ({
    label: dayLabel(point.timestamp),
    value: point.chatRuns,
  }))
  return {
    pending: query.isPending,
    failed,
    retry: () => void query.refetch(),
    unavailable: isApiClientError(query.error) && query.error.status === 404,
    workspaceName: query.data?.workspace?.name,
    metrics: [
      {
        label: 'Workflow runs',
        value: totals?.workflowRuns.toLocaleString() ?? '—',
        description: 'Retained executions, grouped by start date.',
      },
      {
        label: 'Chat runs',
        value: totals?.chatRuns.toLocaleString() ?? '—',
        description: 'Recorded executions in organization chats. Continuations count once.',
      },
      {
        label: 'Chat members',
        value: totals?.chatMembers.toLocaleString() ?? '—',
        description: 'Members with recorded chat runs in this period.',
      },
      {
        label: 'Failure rate',
        value: formatFailureRate(totals?.failureRate ?? null),
        description: 'Failed workflows as a share of completed and failed workflows.',
      },
      {
        label: 'Avg. duration',
        value: formatDurationMs(totals?.averageDurationMs ?? null),
        description: 'Completed and failed workflows with a recorded duration.',
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
  return {
    rows: query.data?.rows.map((row) => ({
      ...row,
      failureRateLabel: formatFailureRate(row.failureRate),
    })),
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
function usageWindowHref(path: string, window: OrganizationUsageWindowKey): string {
  return serializeOrganizationUsageParams(path, {
    preset: window.preset,
    startDate: window.startDate ?? null,
    endDate: window.endDate ?? null,
  })
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

const REQUEST_LIMIT = 100

interface MothershipUserUsage {
  user_id: string
  request_count: number
  total_cost: number
  last_request: string
}

interface MothershipUsageSummary {
  total_requests?: number
  total_users?: number
  users?: MothershipUserUsage[]
}

interface MothershipRequest {
  request_id: string
  model: string
  duration_ms: number
  billed_total_cost: number
  tool_call_count: number
  error: boolean
  aborted: boolean
  created_at: string
}

interface MothershipRequestPage {
  count?: number
  requests?: MothershipRequest[]
}

interface MothershipLicense {
  id: string
  name: string
  count: number
  expiration_date?: string
  created_at: string
}

interface MothershipLicenseList {
  licenses?: MothershipLicense[]
}

/**
 * Usage in one environment over a time range: the per-user breakdown with its total cost, and the
 * most recent requests. The admin proxy returns upstream JSON verbatim, so the shapes are named here.
 */
export function useMothershipOverview(environment: MothershipEnv, start: string, end: string) {
  const breakdown = useMothershipUserBreakdown(environment, start, end)
  const requests = useMothershipRequests(environment, start, end)
  const summary: MothershipUsageSummary | undefined = breakdown.data
  const page: MothershipRequestPage | undefined = requests.data
  return {
    breakdown: summary,
    breakdownLoading: breakdown.isLoading,
    totalCost: summary?.users?.reduce((sum, user) => sum + user.total_cost, 0),
    recentRequests: page?.requests?.slice(0, REQUEST_LIMIT),
    requestCount: page?.count,
    requestsLoading: requests.isLoading,
  }
}

/** Every license issued in one environment. */
export function useMothershipLicenseList(environment: MothershipEnv) {
  const { data, isLoading } = useMothershipLicenses(environment)
  const list: MothershipLicenseList | undefined = data
  return { licenses: list?.licenses, isLoading }
}
