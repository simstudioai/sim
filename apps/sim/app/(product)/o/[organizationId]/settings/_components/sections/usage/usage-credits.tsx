'use client'

import { BarChart } from '@sim/emcn/chart/charts'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/sections/usage/usage-section.module.css'
import type { useUsageOverview } from '@/platform/lib/data/usage'
import { LOCALE } from '@/platform/shared/time'

/**
 * Headline, allowance and the source-stacked credit chart for the toolbar's period. The chart titles
 * the group: the period is already named by the menu above it.
 */
export function UsageCredits({ overview }: { overview: ReturnType<typeof useUsageOverview> }) {
  const { chart } = overview
  return (
    <div className={styles.block} data-dimmed={overview.dimmed || undefined}>
      {chart.loaded && (
        <div className={styles.figure}>
          <span data-type='T102'>{chart.used.toLocaleString(LOCALE)}</span>
          <span className={styles.quiet} data-type='T060'>
            {chart.used === 1 ? 'credit' : 'credits'}
          </span>
          {chart.deltaLabel && (
            <StatusTag label={chart.deltaLabel} intent={chart.deltaRose ? 'warning' : 'neutral'} />
          )}
          {chart.overLimit && <StatusTag label='Over limit' intent='danger' />}
        </div>
      )}
      {chart.loaded && chart.limit !== null && (
        <span className={styles.quiet} data-type='T060'>
          {`${chart.limitPercent}% of ${chart.limit.toLocaleString(LOCALE)}`}
        </span>
      )}
      {overview.failed ? (
        <FailureNotice message='Couldn’t load credits.' onRetry={overview.retry} />
      ) : !chart.loaded ? null : (
        <BarChart
          title='Credits'
          bars={chart.bars}
          series={chart.series}
          seriesTotals={chart.seriesTotals}
          hideEmptySeries
        />
      )}
    </div>
  )
}
