'use client'

import { QueryErrorState } from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import styles from '@/platform/app/(shell)/settings/_components/sections/usage/usage-section.module.css'
import { BarChart, StatusTag } from '@/platform/design-system/components'
import type { useUsageOverview } from '@/platform/lib/data/usage'

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
      <h2 data-type='T093'>{label}</h2>
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
        <span className={styles.quiet} data-type='T060'>
          {`${chart.limitPercent}% of ${chart.limit.toLocaleString()}`}
        </span>
      )}
      {overview.failed ? (
        <QueryErrorState message='Couldn’t load credits.' onRetry={overview.retry} />
      ) : !chart.loaded ? (
        <span className={styles.chartPlaceholder} role='status' aria-label='Loading credits' />
      ) : (
        <BarChart title='Credits' bars={chart.bars} series={chart.series} hideEmptySeries />
      )}
    </section>
  )
}
