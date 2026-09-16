'use client'

import { useMemo } from 'react'
import { Badge, BarChart, ChartFrame, cn } from '@sim/emcn'
import type { OrganizationUsageSummary } from '@/lib/api/contracts/organization-usage'
import { formatCreditsLabel } from '@/lib/billing/credits/conversion'

interface UsageSummaryProps {
  summary?: OrganizationUsageSummary
  limitCredits?: number | null
  isLoading: boolean
  isError: boolean
  isPlaceholderData?: boolean
}

export function UsageSummary({
  summary,
  limitCredits,
  isLoading,
  isError,
  isPlaceholderData,
}: UsageSummaryProps) {
  const series = useMemo(
    () =>
      summary?.series.map((point) => ({ timestamp: point.timestamp, value: point.credits })) ?? [],
    [summary]
  )
  const used = !isError ? (summary?.totals.credits ?? 0) : 0
  const previous = !isError ? (summary?.previousTotals?.credits ?? 0) : 0
  const delta = previous > 0 ? ((used - previous) / previous) * 100 : null
  const hasLimit = limitCredits != null && limitCredits > 0
  return (
    <div className={cn('flex flex-col gap-3', isPlaceholderData && 'opacity-50')}>
      <div className='flex flex-col gap-1'>
        <div className='flex h-6 items-baseline gap-2 whitespace-nowrap'>
          <span className='text-[var(--text-body)] text-base tabular-nums'>
            {isError || !summary ? '—' : formatCreditsLabel(used)}
          </span>
          {hasLimit && (
            <span className='text-[var(--text-muted)] text-caption tabular-nums'>
              of {limitCredits.toLocaleString()}
            </span>
          )}
        </div>
        <div className='flex h-5 items-center gap-2 whitespace-nowrap'>
          {delta !== null && (
            <Badge
              variant={delta > 0 ? 'amber' : 'gray-secondary'}
              size='sm'
              aria-label={`${Math.abs(delta).toFixed(0)}% ${delta > 0 ? 'increase' : delta < 0 ? 'decrease' : 'change'} compared with the previous period`}
            >{`${delta > 0 ? '↑' : '↓'} ${Math.abs(delta).toFixed(0)}%`}</Badge>
          )}
          {hasLimit && used > limitCredits && (
            <Badge variant='red' size='sm'>
              Over limit
            </Badge>
          )}
        </div>
      </div>
      <ChartFrame
        height={160}
        loading={isLoading || (!summary && !isError)}
        error={isError ? "Couldn't load credits." : undefined}
      >
        <BarChart
          xAxisFormat='date'
          data={series}
          label=''
          color='var(--indicator-seat-filled)'
          unit='credits'
          height={160}
        />
      </ChartFrame>
    </div>
  )
}
