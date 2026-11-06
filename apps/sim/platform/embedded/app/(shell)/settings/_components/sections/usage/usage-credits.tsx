'use client'

import { BarChart, FailureNotice, StatusTag } from '@/platform/design-system/components'
import styles from '@/platform/embedded/app/(shell)/settings/_components/sections/usage/usage-section.module.css'
import type { useUsageOverview } from '@/platform/embedded/lib/data/usage'

/** Headline, allowance and the source-stacked credit chart for one window. */
export function UsageCredits({
  label,
  overview,
}: {
  label: string
  overview: ReturnType<typeof useUsageOverview>
}) {
  const { chart } = overview
  return (
    <section className={styles.block} aria-label={label} data-dimmed={overview.dimmed || undefined}>
      <h2 data-type='T042'>{label}</h2>
      <div className={styles.figure}>
        <span data-type='T102'>{chart.loaded ? chart.used.toLocaleString() : '—'}</span>
        <span className={styles.quiet} data-type='T060'>
          {chart.used === 1 ? 'credit' : 'credits'}
        </span>
        {chart.deltaLabel && (
          <StatusTag label={chart.deltaLabel} intent={chart.deltaRose ? 'warning' : 'neutral'} />
        )}
        {chart.overLimit && <StatusTag label='Over limit' intent='danger' />}
      </div>
      {chart.limit !== null && (
        <div className={styles.allowance}>
          <div
            className={styles.meter}
            role='meter'
            aria-label='Share of the organization allowance used'
            aria-valuemin={0}
            aria-valuemax={chart.limit}
            aria-valuenow={Math.min(chart.used, chart.limit)}
          >
            <span
              className={styles.meterFill}
              data-over={chart.overLimit || undefined}
              style={{ inlineSize: `${Math.min(100, chart.limitPercent)}%` }}
            />
          </div>
          <span className={styles.quiet} data-type='T060'>
            {`${chart.limitPercent}% of ${chart.limit.toLocaleString()}`}
          </span>
        </div>
      )}
      {overview.failed ? (
        <FailureNotice message='Couldn’t load credits.' onRetry={overview.retry} />
      ) : !chart.loaded ? (
        <span className={styles.chartPlaceholder} role='status' aria-label='Loading credits' />
      ) : (
        <BarChart
          title='Credits by source'
          bars={chart.bars}
          series={chart.series}
          seriesTotals={chart.seriesTotals}
          hideEmptySeries
        />
      )}
    </section>
  )
}
