'use client'

import styles from '@/platform/app/(shell)/settings/_components/sections/usage/usage-section.module.css'
import { BarChart, Button, InlineNotice, StatusTag } from '@/platform/design-system/components'
import type { useUsageOverview } from '@/platform/lib/data/usage'

function deltaLabel(delta: number): string {
  return `${delta > 0 ? '↑ ' : delta < 0 ? '↓ ' : ''}${Math.abs(delta)}%`
}

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
        {chart.delta !== null && (
          <StatusTag
            label={deltaLabel(chart.delta)}
            intent={chart.delta > 0 ? 'warning' : 'neutral'}
          />
        )}
        {chart.overLimit && <StatusTag label='Over limit' intent='danger' />}
      </div>
      {chart.limit !== null && (
        <span className={styles.quiet} data-type='T060'>
          {`${chart.limitPercent}% of ${chart.limit.toLocaleString()}`}
        </span>
      )}
      {overview.failed ? (
        <InlineNotice
          intent='danger'
          message='Couldn’t load credits.'
          action={
            <Button variant='quiet' size='compact' onClick={overview.retry}>
              Retry
            </Button>
          }
        />
      ) : !chart.loaded ? (
        <span className={styles.chartPlaceholder} role='status' aria-label='Loading credits' />
      ) : (
        <BarChart title='Credits' bars={chart.bars} series={chart.series} />
      )}
    </section>
  )
}
