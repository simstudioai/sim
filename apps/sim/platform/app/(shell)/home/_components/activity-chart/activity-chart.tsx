'use client'

import { useState } from 'react'
import styles from '@/platform/app/(shell)/home/_components/activity-chart/activity-chart.module.css'
import type {
  ActivityPoint,
  HomeActivityState,
} from '@/platform/app/(shell)/home/_components/model'
import { RetryButton } from '@/platform/app/(shell)/home/_components/retry-button/retry-button'
import { SkeletonBlock } from '@/platform/app/(shell)/home/_components/widget-skeleton/widget-skeleton'
import { TrendPlot } from '@/platform/design-system/catalog/plots'
import { InlineNotice } from '@/platform/design-system/components'
import { chartNumber, chartTick } from '@/platform/design-system/components/chart/chart-format'
import { ChartTooltip } from '@/platform/design-system/components/chart/chart-tooltip'
import { usePlotInspection } from '@/platform/design-system/components/chart/use-plot-inspection'
import { RangePicker } from '@/platform/design-system/components/menu/range-picker'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import { formatCalendarDate } from '@/platform/lib/time'

interface HomeActivityChartProps {
  title: string
  state: HomeActivityState
  onRetry: () => void
}

interface ActivitySeriesProps {
  title: string
  points: readonly ActivityPoint[]
}

function ActivitySeries({ title, points }: ActivitySeriesProps) {
  const tickEdges = useScrollEdges<HTMLLIElement>('horizontal')
  const inspection = usePlotInspection(points.length)
  const active = inspection.active
  const point = active === undefined ? undefined : points[active]
  const values = points.map((item) => item.value)
  const max = values.reduce((max, value) => Math.max(max, value), 2)
  const power = 10 ** Math.floor(Math.log10(max))
  const peak = ([1, 2, 5, 10].find((step) => step * power >= max) ?? 10) * power
  const labels = points.filter(
    (_, i) => i === 0 || i === Math.floor((points.length - 1) / 2) || i === points.length - 1
  )
  return (
    <div className={styles.grid}>
      <div aria-hidden='true' className={styles.scale} data-type='T034'>
        {[peak, peak / 2, 0].map((n) => (
          <span key={n}>{chartTick(n)}</span>
        ))}
      </div>
      <div
        className={styles.plot}
        data-plot='home-activity'
        role='group'
        aria-label={`${title} data`}
        aria-describedby={point ? inspection.tooltipId : undefined}
        tabIndex={points.length ? 0 : undefined}
        onFocus={inspection.onFocus}
        onBlur={inspection.onBlur}
        onKeyDown={inspection.onKeyDown}
        onPointerMove={inspection.onPointerMove}
        onPointerLeave={inspection.onPointerLeave}
      >
        <div className={styles.lines} aria-hidden='true'>
          <i />
          <i />
          <i />
        </div>
        <TrendPlot label={title} values={values} maximum={peak} active={active} straight />
        {point && (
          <div ref={inspection.tooltipAnchor} className={styles.tooltipPosition}>
            <ChartTooltip
              id={inspection.tooltipId}
              heading={formatCalendarDate(point.date, 'full')}
              entries={[{ label: title, value: point.value }]}
            />
          </div>
        )}
      </div>
      <ul className={styles.ticks} aria-label='Chart periods' data-type='T034'>
        {labels.map((label) => (
          <li ref={tickEdges} key={label.date}>
            {formatCalendarDate(label.date)}
          </li>
        ))}
      </ul>
    </div>
  )
}

const WINDOW_DAYS = [7, 30, 90] as const
const RANGE_LABELS = WINDOW_DAYS.map((days) => `Last ${days} days`)

export function HomeActivityChart({ title, state, onRetry }: HomeActivityChartProps) {
  const [range, setRange] = useState(RANGE_LABELS[0])
  const scrollEdges = useScrollEdges<HTMLElement>('vertical', { tabStop: true })
  if (state.status === 'hidden') return null
  const ready = state.status === 'ready'
  const days = WINDOW_DAYS[RANGE_LABELS.indexOf(range)]
  const points = ready ? state.points.slice(-days) : []
  const total = points.reduce((sum, point) => sum + point.value, 0)
  return (
    <section ref={scrollEdges} className={styles.chart} aria-label={title}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2 data-type='T042'>{title}</h2>
          {ready && (
            <span className={styles.total} data-type='T076'>
              {chartNumber.format(total)}
            </span>
          )}
        </div>
        {ready && (
          <RangePicker
            label='Range'
            options={RANGE_LABELS}
            value={range}
            onValueChange={setRange}
          />
        )}
      </header>
      {state.status === 'loading' && <SkeletonBlock label={`Loading ${title}`} />}
      {state.status === 'error' && (
        <InlineNotice
          intent='warning'
          message='This chart could not load.'
          action={<RetryButton retrying={state.retrying} onRetry={onRetry} />}
        />
      )}
      {ready && <ActivitySeries key={range} title={title} points={points} />}
    </section>
  )
}
