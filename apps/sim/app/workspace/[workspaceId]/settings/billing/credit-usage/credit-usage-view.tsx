'use client'

import { useState } from 'react'
import {
  Calendar,
  Chip,
  ChipCombobox,
  ChipLink,
  type ComboboxOption,
  chipVariants,
  cn,
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@sim/emcn'
import { ArrowLeft, Download } from '@sim/emcn/icons'
import { formatDateTime } from '@sim/utils/formatting'
import { useQueryStates } from 'nuqs'
import type { UsageLogEntry, UsageLogPeriod } from '@/lib/api/contracts/user'
import { formatApportionedCreditCost, formatCreditsLabel } from '@/lib/billing/credits/conversion'
import { USAGE_LOG_SOURCE_LABELS } from '@/app/api/users/me/usage-logs/source-labels'
import { CredentialDetailLayout } from '@/app/workspace/[workspaceId]/components/credential-detail'
import { formatDateShort } from '@/app/workspace/[workspaceId]/logs/utils'
import {
  creditUsageParsers,
  creditUsageUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/billing/credit-usage/search-params'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
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
      <span className='w-[150px] flex-shrink-0 text-[12px] text-[var(--text-muted)]'>
        {formatDateTime(new Date(log.createdAt))}
      </span>
      <span className='min-w-0 flex-1 truncate text-[14px] text-[var(--text-body)]'>
        {rowLabel(log)}
      </span>
      <span className='flex-shrink-0 text-[12px] text-[var(--text-muted)] tabular-nums'>
        {formatApportionedCreditCost(log.creditCost, log.dollarCost)}
      </span>
    </div>
  )
}

interface CreditUsageViewProps {
  workspaceId: string
}

export function CreditUsageView({ workspaceId }: CreditUsageViewProps) {
  const billingHref = `/workspace/${workspaceId}/settings/billing`

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
   * Downloads a CSV of every log matching the current filter — a plain anchor
   * navigation to the export route, not a `fetch`, so the browser handles the
   * download natively via the response's `Content-Disposition` header.
   */
  const handleExport = () => {
    const params = new URLSearchParams({ period })
    if (period === 'custom' && startDate && endDate) {
      params.set('startDate', startDate)
      params.set('endDate', endDate)
    }
    const link = document.createElement('a')
    link.href = `/api/users/me/usage-logs/export?${params.toString()}`
    document.body.appendChild(link)
    link.click()
    link.remove()
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
    <CredentialDetailLayout
      back={
        <ChipLink href={billingHref} leftIcon={ArrowLeft}>
          Billing
        </ChipLink>
      }
      actions={
        <Chip leftIcon={Download} onClick={handleExport} disabled={logs.length === 0}>
          Export
        </Chip>
      }
    >
      <div className='flex flex-col gap-1'>
        <h1 className='font-medium text-[var(--text-body)] text-lg'>Credit usage</h1>
        <p className='text-[var(--text-muted)] text-md'>
          Every credit-consuming event behind your usage.
        </p>
      </div>

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
                startDate={startDate}
                endDate={endDate}
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
    </CredentialDetailLayout>
  )
}
