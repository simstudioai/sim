'use client'

import { useMemo } from 'react'
import {
  Badge,
  BarChart,
  type BarChartSeries,
  ChartFrame,
  ChartLegend,
  type ChartLegendItem,
  cn,
  formatChartCompactNumber,
} from '@sim/emcn'
import type { OrganizationUsageOverview } from '@/lib/api/contracts/organization-usage'
import {
  USAGE_SOURCE_CATEGORIES,
  USAGE_SOURCE_CATEGORY,
  type UsageSourceCategoryId,
} from '@/ee/organization-usage/constants'
import { useLegendHighlight } from '@/ee/organization-usage/hooks/use-legend-highlight'

const CHART_HEIGHT = 200

interface CreditLayers {
  layers: BarChartSeries[]
  legend: ChartLegendItem[]
}

/**
 * Folds the per-source cells into the chart's fixed categories.
 *
 * Only categories with usage are drawn, but each keeps its own color, so a quiet
 * period never repaints the survivors. A window with no usage still draws its empty
 * buckets as one zero layer — a flat baseline is information, "No data" reads as a
 * failure.
 */
function toCreditLayers(series: OrganizationUsageOverview['series']): CreditLayers {
  const byCategory = new Map<UsageSourceCategoryId, number[]>()
  series.forEach((point, index) => {
    for (const [source, credits] of Object.entries(point.sources)) {
      const category = USAGE_SOURCE_CATEGORY[source as keyof typeof USAGE_SOURCE_CATEGORY]
      let values = byCategory.get(category)
      if (!values) {
        values = new Array<number>(series.length).fill(0)
        byCategory.set(category, values)
      }
      values[index] += credits ?? 0
    }
  })

  const present = USAGE_SOURCE_CATEGORIES.flatMap((category) => {
    const values = byCategory.get(category.id)
    return values ? [{ category, values }] : []
  })
  if (present.length === 0) {
    return {
      layers: [
        {
          id: 'credits',
          label: 'Credits',
          color: USAGE_SOURCE_CATEGORIES[0].color,
          data: series.map((point) => ({ timestamp: point.timestamp, value: 0 })),
        },
      ],
      legend: [],
    }
  }

  return {
    layers: present.map(({ category, values }) => ({
      id: category.id,
      label: category.label,
      color: category.color,
      data: series.map((point, index) => ({ timestamp: point.timestamp, value: values[index] })),
    })),
    legend: present.map(({ category, values }) => ({
      id: category.id,
      label: category.label,
      color: category.color,
      value: formatChartCompactNumber(values.reduce((sum, value) => sum + value, 0)),
    })),
  }
}

interface UsageCreditsProps {
  overview?: OrganizationUsageOverview
  isLoading: boolean
  isError: boolean
  /** Dims the figures while a re-keyed fetch resolves, rather than blanking them. */
  isPlaceholderData?: boolean
  onRetry?: () => void
}

/** Headline, allowance, and the source-stacked credit chart for one window. */
export function UsageCredits({
  overview,
  isLoading,
  isError,
  isPlaceholderData,
  onRetry,
}: UsageCreditsProps) {
  /** A failed refresh keeps its last data; no figure, badge, or legend may be drawn from it. */
  const current = isError ? undefined : overview
  const { layers, legend } = useMemo(() => toCreditLayers(current?.series ?? []), [current])
  const used = current?.totals.credits ?? 0
  const previous = current?.previousTotals?.credits ?? 0
  /** Rounded once, so the arrow and the figure never disagree about a sub-percent change. */
  const delta = current && previous > 0 ? Math.round(((used - previous) / previous) * 100) : null
  const limit = current?.limitCredits ?? null
  const highlight = useLegendHighlight(legend.map((item) => item.id))

  return (
    <div className={cn('flex flex-col gap-4', isPlaceholderData && 'opacity-50')}>
      <div className='flex flex-col gap-1.5'>
        <div className='flex h-7 items-baseline gap-2 whitespace-nowrap'>
          <span className='text-[var(--text-body)] text-lg tabular-nums'>
            {current ? used.toLocaleString() : '—'}
          </span>
          <span className='text-[var(--text-muted)] text-caption'>
            {used === 1 ? 'credit' : 'credits'}
          </span>
          {delta !== null && (
            <Badge
              variant={delta > 0 ? 'amber' : 'gray-secondary'}
              size='sm'
              aria-label={
                delta === 0
                  ? 'No change compared with the previous period'
                  : `${Math.abs(delta)}% ${delta > 0 ? 'increase' : 'decrease'} compared with the previous period`
              }
            >{`${delta > 0 ? '↑ ' : delta < 0 ? '↓ ' : ''}${Math.abs(delta)}%`}</Badge>
          )}
          {limit !== null && used > limit && (
            <Badge variant='red' size='sm'>
              Over limit
            </Badge>
          )}
        </div>
        {limit !== null && (
          <div className='flex items-center gap-2'>
            <div
              className='h-[4px] w-[120px] overflow-hidden rounded-full bg-[var(--border)]'
              role='meter'
              aria-label='Share of the organization allowance used'
              aria-valuemin={0}
              aria-valuemax={limit}
              aria-valuenow={Math.min(used, limit)}
            >
              <div
                className={cn(
                  'h-full rounded-full',
                  used > limit ? 'bg-[var(--text-error)]' : 'bg-[var(--brand-blue)]'
                )}
                style={{ width: `${Math.min(100, (used / limit) * 100)}%` }}
              />
            </div>
            <span className='text-[var(--text-muted)] text-caption tabular-nums'>
              {`${Math.round((used / limit) * 100)}% of ${limit.toLocaleString()}`}
            </span>
          </div>
        )}
      </div>
      <ChartFrame
        height={CHART_HEIGHT}
        loading={isLoading || (!overview && !isError)}
        error={isError ? "Couldn't load credits." : undefined}
        onRetry={onRetry}
      >
        <BarChart
          label=''
          unit='credits'
          xAxisFormat='date'
          height={CHART_HEIGHT}
          series={layers}
          highlightedSeriesId={highlight.highlightedId}
        />
      </ChartFrame>
      {legend.length > 1 && <ChartLegend layout='row' items={legend} {...highlight.legendProps} />}
    </div>
  )
}
