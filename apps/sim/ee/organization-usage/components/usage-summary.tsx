'use client'

import { Badge } from '@sim/emcn'
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
}

function percentDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}

export function UsageSummary({ summary, limitCredits, isLoading, isError }: UsageSummaryProps) {
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
    <div className='flex flex-col gap-3'>
      {/*
        One line, and the allowance sits beside the figure rather than under it —
        restating "4,958 credits used" below a "4,958 credits" headline said the same
        number twice and read as a rendering bug.
      */}
      <div className='flex flex-wrap items-baseline gap-x-2 gap-y-1'>
        <span className='text-[var(--text-body)] text-lg tabular-nums'>
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
          <Badge variant='amber' size='sm'>
            Over limit
          </Badge>
        )}
      </div>

      <BarChart
        data={summary.series.map((point) => ({
          timestamp: point.timestamp,
          value: point.credits,
        }))}
        label=''
        color={USAGE_SERIES_COLOR}
        unit='credits'
        height={160}
      />
    </div>
  )
}
