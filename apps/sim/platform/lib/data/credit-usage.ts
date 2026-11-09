'use client'

import { createLogger } from '@sim/logger'
import { formatDateTime } from '@sim/utils/formatting'
import { useSearchParams } from 'next/navigation'
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs'
import {
  type UsageLogEntry,
  type UsageLogPeriod,
  usageLogPeriodSchema,
} from '@/lib/api/contracts/user'
import { formatApportionedCreditCost, formatCreditsLabel } from '@/lib/billing/credits/conversion'
import { BILLING_USAGE_LOG_SOURCE_LABELS } from '@/lib/billing/usage-sources'
import { toast } from '@/lib/toast/sink'
import { saveBlob } from '@/lib/uploads/client/download'
import { useUsageLogs, useUsageSummary } from '@/hooks/queries/usage-logs'
import { platformHref } from '@/platform/lib/navigation'
import { loadMoreOf, queryView } from '@/platform/shared/query-view'

const logger = createLogger('PlatformCreditUsage')

/** The legacy page's query keys; `period` shares its literals with the API contract. */
const creditUsageParsers = {
  period: parseAsStringLiteral(usageLogPeriodSchema.options).withDefault('30d'),
  startDate: parseAsString,
  endDate: parseAsString,
} as const

const creditUsageUrlKeys = {
  history: 'replace',
  shallow: true,
  clearOnDefault: true,
} as const

const PERIOD_OPTIONS = [
  { value: '1d', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
] as const satisfies readonly { value: UsageLogPeriod; label: string }[]

/** Workflow rows name the workflow; everything else uses the plain source label. */
function rowLabel(log: UsageLogEntry): string {
  if (log.source === 'workflow' && log.workflowName) return `Workflow: ${log.workflowName}`
  return BILLING_USAGE_LOG_SOURCE_LABELS[log.source]
}

/** The Subscription glance: the viewer's credits over the last 30 days. */
export function useCreditUsageSummary() {
  const search = useSearchParams()
  const summary = useUsageSummary('30d')
  return {
    ...queryView(summary),
    total: formatCreditsLabel(summary.data ?? 0),
    href: platformHref('/settings/billing/credit-usage', search),
  }
}

/** Every credit-consuming event behind the viewer's usage, filtered by the URL's period. */
export function useCreditUsageLog() {
  const search = useSearchParams()
  const [{ period, startDate, endDate }, setFilters] = useQueryStates(
    creditUsageParsers,
    creditUsageUrlKeys
  )
  const custom = period === 'custom'
  const logs = useUsageLogs({
    period,
    startDate: custom ? startDate || undefined : undefined,
    endDate: custom ? endDate || undefined : undefined,
  })
  const total = logs.data?.pages[0]?.summary.totalCredits
  return {
    backHref: platformHref('/settings/billing', search),
    periodOptions: PERIOD_OPTIONS,
    period,
    range: custom && startDate && endDate ? { start: startDate, end: endDate } : null,
    selectPeriod: (value: string) => {
      const next = PERIOD_OPTIONS.find((option) => option.value === value)
      if (next && next.value !== 'custom')
        void setFilters({ period: next.value, startDate: null, endDate: null })
    },
    applyRange: (start: string, end: string) =>
      void setFilters({ period: 'custom', startDate: start, endDate: end }),
    pending: logs.isLoading,
    failed: logs.isError && logs.data === undefined,
    dimmed: logs.isPlaceholderData,
    retry: () => void logs.refetch(),
    total: total === undefined ? null : formatCreditsLabel(total),
    rows: (logs.data?.pages.flatMap((page) => page.logs) ?? []).map((log) => ({
      id: log.id,
      when: formatDateTime(new Date(log.createdAt)),
      label: rowLabel(log),
      credits: formatApportionedCreditCost(log.creditCost, log.hasCost),
    })),
    loadMore: loadMoreOf(logs, 'Failed to load more usage'),
    exportCsv: () =>
      exportCreditUsageCsv(period, custom ? startDate : null, custom ? endDate : null),
  }
}

/**
 * Downloads a CSV of every log matching the filter. Fetches rather than following an anchor so the
 * `X-Export-Truncated` header can be read before saving.
 */
async function exportCreditUsageCsv(
  period: UsageLogPeriod,
  startDate: string | null,
  endDate: string | null
): Promise<void> {
  const params = new URLSearchParams({ period })
  if (startDate) params.set('startDate', startDate)
  if (endDate) params.set('endDate', endDate)
  try {
    // boundary-raw-fetch: downloads a CSV blob and reads X-Export-Truncated before saving, which a plain anchor navigation can do neither of
    const response = await fetch(`/api/users/me/usage-logs/export?${params}`)
    if (!response.ok) {
      toast.error('Failed to export usage logs')
      return
    }
    if (response.headers.get('X-Export-Truncated') === '1') {
      toast.info('Export truncated: narrow the date range to see everything')
    }
    saveBlob(
      await response.blob(),
      `credit-usage-${period}-${new Date().toISOString().slice(0, 10)}.csv`
    )
  } catch (error) {
    logger.error('Failed to export usage logs', { error })
    toast.error('Failed to export usage logs')
  }
}
