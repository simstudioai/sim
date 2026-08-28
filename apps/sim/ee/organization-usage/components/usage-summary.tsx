'use client'

import { useMemo } from 'react'
import { Badge, cn } from '@sim/emcn'
import { BarChart } from '@/components/charts'
import type { OrganizationUsageSummary } from '@/lib/api/contracts/organization-usage'
import { formatCreditsLabel } from '@/lib/billing/credits/conversion'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'

/** Consumption, matching the seat meter's indicator rather than an outcome colour. */
const USAGE_SERIES_COLOR = 'var(--indicator-seat-filled)'

interface UsageSummaryProps {
  summary?: OrganizationUsageSummary
  /** Pooled allowance in credits, from the organization's billing data. `null` when uncapped. */
  limitCredits?: number | null
  isLoading: boolean
  isError: boolean
  /**
   * Dims the figures while a re-keyed fetch resolves, rather than blanking them — the
   * same treatment `UsageConsumers` gives a retained list. Without it the headline and
   * chart present the previous period's numbers as though they were the new period's.
   */
  isPlaceholderData?: boolean
}

function percentDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}

export function UsageSummary({
  summary,
  limitCredits,
  isLoading,
  isError,
  isPlaceholderData,
}: UsageSummaryProps) {
  /*
    Stabilized so `BarChart`'s `memo()` can actually pass. Built inline it was a new
    array on every render of the panel — a date-picker toggle or an export click
    re-rendered ninety bars for nothing.
  */
  const series = useMemo(
    () =>
      summary?.series.map((point) => ({ timestamp: point.timestamp, value: point.credits })) ?? [],
    [summary]
  )

  if (isError) {
    return (
      <SettingsEmptyState variant='inline' tone='error'>
        Couldn't load usage.
      </SettingsEmptyState>
    )
  }
  if (isLoading || !summary) {
    return <SettingsEmptyState variant='inline'>Loading usage…</SettingsEmptyState>
  }

  const used = summary.totals.credits
  const delta = summary.previousTotals ? percentDelta(used, summary.previousTotals.credits) : null
  const hasLimit = limitCredits != null && limitCredits > 0
  const isOverLimit = hasLimit && used > limitCredits

  return (
    <div
      className={cn('flex flex-col gap-3', isPlaceholderData && 'opacity-50 transition-opacity')}
    >
      {/*
        One line, and the allowance sits beside the figure rather than under it —
        restating "4,958 credits used" below a "4,958 credits" headline said the same
        number twice and read as a rendering bug.
      */}
      <div className='flex flex-wrap items-baseline gap-x-2 gap-y-1'>
        {/*
          `text-base`, not `text-lg`: the shell's page title is `text-lg`, and a
          metric drawn at the same size competed with the header for the first read.
        */}
        <span className='text-[var(--text-body)] text-base tabular-nums'>
          {formatCreditsLabel(used)}
        </span>
        {hasLimit && (
          // Bare number, not `formatCreditsLabel`: the headline beside it already
          // names the unit, and "4,958 credits of 200,000 credits" says it twice.
          <span className='text-[var(--text-muted)] text-caption tabular-nums'>
            of {limitCredits.toLocaleString()}
          </span>
        )}
        {delta !== null && (
          <Badge variant={delta > 0 ? 'amber' : 'gray-secondary'} size='sm'>
            {`${delta > 0 ? '↑' : '↓'} ${Math.abs(delta).toFixed(0)}% vs last period`}
          </Badge>
        )}
        {isOverLimit && (
          // `red`, not `amber`: past the pooled allowance is a violation, and the
          // trend badge sitting immediately beside it is already amber.
          <Badge variant='red' size='sm'>
            Over limit
          </Badge>
        )}
      </div>

      <BarChart data={series} label='' color={USAGE_SERIES_COLOR} unit='credits' height={160} />
    </div>
  )
}
