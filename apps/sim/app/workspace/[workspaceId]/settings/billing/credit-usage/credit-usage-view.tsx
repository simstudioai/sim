'use client'

import { useState } from 'react'
import {
  Calendar,
  ChipCombobox,
  type ComboboxOption,
  chipVariants,
  cn,
  Popover,
  PopoverAnchor,
  PopoverContent,
  toast,
} from '@sim/emcn'
import { ArrowLeft, Download } from '@sim/emcn/icons'
import { formatDateTime } from '@sim/utils/formatting'
import { useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import type { UsageLogEntry, UsageLogPeriod } from '@/lib/api/contracts/user'
import { formatApportionedCreditCost, formatCreditsLabel } from '@/lib/billing/credits/conversion'
import { USAGE_LOG_SOURCE_LABELS } from '@/app/api/users/me/usage-logs/source-labels'
import { formatDateShort } from '@/app/workspace/[workspaceId]/logs/utils'
import {
  creditUsageParsers,
  creditUsageUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/billing/credit-usage/search-params'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { useUsageLogs } from '@/hooks/queries/usage-logs'

const PERIOD_OPTIONS: ComboboxOption[] = [
  { value: '1d', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
  { value: 'custom', label: 'Custom range' },
]

/** Workflow-sourced rows name the specific workflow; everything else uses the plain source label. */
function rowLabel(log: UsageLogEntry): string {
  if (log.source === 'workflow' && log.workflowName) return `Workflow: ${log.workflowName}`
  return USAGE_LOG_SOURCE_LABELS[log.source]
}

interface UsageLogRowProps {
  log: UsageLogEntry
}

function UsageLogRow({ log }: UsageLogRowProps) {
  return (
    <div className='flex items-center gap-2.5 rounded-lg p-2 text-left'>
      <span className='w-[150px] flex-shrink-0 text-[var(--text-muted)] text-caption'>
        {formatDateTime(new Date(log.createdAt))}
      </span>
      <span className='min-w-0 flex-1 truncate text-[var(--text-body)] text-sm'>
        {rowLabel(log)}
      </span>
      <span className='flex-shrink-0 text-[var(--text-muted)] text-caption tabular-nums'>
        {formatApportionedCreditCost(log.creditCost, log.dollarCost)}
      </span>
    </div>
  )
}

export function CreditUsageView() {
  const router = useRouter()
  const [{ period, startDate, endDate }, setFilters] = useQueryStates(
    creditUsageParsers,
    creditUsageUrlKeys
  )
  const [datePickerOpen, setDatePickerOpen] = useState(false)

  const handlePeriodChange = (value: string) => {
    if (value === 'custom') {
      setDatePickerOpen(true)
      return
    }
    setFilters({ period: value as UsageLogPeriod, startDate: null, endDate: null })
  }

  const handleDateRangeApply = (nextStart: string, nextEnd: string) => {
    setFilters({ period: 'custom', startDate: nextStart, endDate: nextEnd })
    setDatePickerOpen(false)
  }

  const handleDatePickerCancel = () => {
    setDatePickerOpen(false)
  }

  /**
   * Downloads a CSV of every log matching the current filter. Fetches rather
   * than navigating a plain anchor to the export URL so the client can read
   * the `X-Export-Truncated` response header and surface it — an anchor
   * navigation has no way to inspect the response before the browser commits
   * to the download.
   */
  const handleExport = async () => {
    const params = new URLSearchParams({ period })
    if (period === 'custom') {
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
    }

    // boundary-raw-fetch: downloads a CSV blob and reads a response header before saving — a plain anchor navigation can't do either
    const response = await fetch(`/api/users/me/usage-logs/export?${params.toString()}`)
    if (!response.ok) {
      toast.error('Failed to export usage logs')
      return
    }
    if (response.headers.get('X-Export-Truncated') === '1') {
      toast.info('Export truncated — narrow the date range to see everything')
    }

    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `credit-usage-${period}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const periodDisplayLabel =
    period === 'custom' && startDate && endDate
      ? `${formatDateShort(startDate)} - ${formatDateShort(endDate)}`
      : (PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? 'Last 30 days')

  const {
    data,
    isLoading,
    isError,
    isPlaceholderData,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
  } = useUsageLogs({
    period,
    startDate: period === 'custom' ? startDate || undefined : undefined,
    endDate: period === 'custom' ? endDate || undefined : undefined,
  })

  const logs = data?.pages.flatMap((page) => page.logs) ?? []
  const totalCredits = data?.pages[0]?.summary.totalCredits ?? 0

  return (
    <SettingsPanel
      back={{
        text: 'Billing',
        icon: ArrowLeft,
        onSelect: () => router.push('/account/settings/billing'),
      }}
      actions={[
        {
          text: 'Export',
          icon: Download,
          onSelect: () => void handleExport(),
          disabled: logs.length === 0 || isPlaceholderData,
        },
      ]}
      title='Credit usage'
      description='Every credit-consuming event behind your usage.'
    >
      <div className='flex items-center justify-between'>
        <span className='text-[var(--text-muted)] text-small'>
          Total: {formatCreditsLabel(totalCredits)}
        </span>
        <div className='relative'>
          <ChipCombobox
            options={PERIOD_OPTIONS}
            value={period}
            onChange={handlePeriodChange}
            overlayContent={
              <span className='truncate text-[var(--text-primary)]'>{periodDisplayLabel}</span>
            }
          />
          <Popover
            open={datePickerOpen}
            onOpenChange={(isOpen) => {
              if (!isOpen) handleDatePickerCancel()
            }}
          >
            <PopoverAnchor className='pointer-events-none absolute inset-0' />
            <PopoverContent align='start' sideOffset={4} className='w-auto p-0'>
              <Calendar
                mode='range'
                showTime
                startDate={startDate ?? undefined}
                endDate={endDate ?? undefined}
                onRangeChange={handleDateRangeApply}
                onCancel={handleDatePickerCancel}
              />
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div
        className={cn(
          '-mx-2 flex flex-col gap-y-0.5',
          isPlaceholderData && 'opacity-50 transition-opacity'
        )}
      >
        {isLoading ? (
          <SettingsEmptyState variant='inline'>Loading usage…</SettingsEmptyState>
        ) : isError ? (
          <SettingsEmptyState variant='inline'>Couldn't load credit usage.</SettingsEmptyState>
        ) : logs.length === 0 ? (
          <SettingsEmptyState variant='inline'>No credit usage in this period.</SettingsEmptyState>
        ) : (
          <>
            {logs.map((log) => (
              <UsageLogRow key={log.id} log={log} />
            ))}
            {hasNextPage && (
              <button
                type='button'
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                aria-label='Load more usage'
                className={cn(
                  chipVariants({ fullWidth: true }),
                  'text-[var(--text-muted)] text-small'
                )}
              >
                {isFetchingNextPage ? 'Loading…' : 'Load more'}
              </button>
            )}
          </>
        )}
      </div>
    </SettingsPanel>
  )
}
