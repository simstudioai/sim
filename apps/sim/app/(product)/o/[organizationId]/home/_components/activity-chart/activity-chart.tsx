'use client'

import { useState } from 'react'
import { TrendPlot } from '@sim/emcn/catalog/plots'
import { chartNumber, chartTick } from '@sim/emcn/chart/format'
import { ChartTooltip } from '@sim/emcn/chart/tooltip'
import { usePlotInspection } from '@sim/emcn/chart/use-plot-inspection'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { InlineNotice } from '@sim/emcn/status'
import styles from '@/app/(product)/o/[organizationId]/home/_components/activity-chart/activity-chart.module.css'
import { RetryButton } from '@/app/(product)/o/[organizationId]/home/_components/retry-button/retry-button'
import type { ActivityPoint, HomeActivityState } from '@/platform/shared/home'
import { DAY_MS, formatCalendarDate } from '@/platform/shared/time'

interface HomeActivityChartProps {
  title: string
  state: HomeActivityState
  onRetry?: () => void
  /** Kept mounted while hidden, so its range survives Customize Home. */
  hidden?: boolean
  /** The workbench opens a specimen on a point or on the range menu. */
  initialPoint?: number
  initiallyOpen?: boolean
}

interface ActivitySeriesProps {
  title: string
  points: readonly ActivityPoint[]
  initialPoint?: number
}

function ActivitySeries({ title, points, initialPoint }: ActivitySeriesProps) {
  const tickEdges = useScrollEdges<HTMLLIElement>('horizontal')
  const inspection = usePlotInspection(points.length, { initialIndex: initialPoint })
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

/** Bars for each calendar day of the window, so a source that omits empty days still lines up. */
function calendarWindow(history: readonly ActivityPoint[], days: number) {
  if (!history.length) return []
  const end = Date.parse(history[history.length - 1].date)
  const start = Math.max(Date.parse(history[0].date), end - (days - 1) * DAY_MS)
  const counts = new Map(history.map(({ date, value }) => [date, value]))
  const points: ActivityPoint[] = []
  for (let day = start; day <= end; day += DAY_MS) {
    const date = new Date(day).toISOString().slice(0, 10)
    const count = counts.get(date) ?? 0
    points.push({ date, value: Number.isFinite(count) && count > 0 ? count : 0 })
  }
  return points
}

export function HomeActivityChart({
  title,
  state,
  onRetry = () => {},
  hidden = false,
  initialPoint,
  initiallyOpen,
}: HomeActivityChartProps) {
  const [range, setRange] = useState(RANGE_LABELS[0])
  if (hidden || state.status === 'hidden') return null
  const ready = state.status === 'ready'
  const days = WINDOW_DAYS[RANGE_LABELS.indexOf(range)]
  const points = ready ? calendarWindow(state.points, days) : []
  const total = points.reduce((sum, point) => sum + point.value, 0)
  return (
    <section className={styles.chart} aria-label={title}>
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
          <ChoiceMenu
            label='Range'
            options={RANGE_LABELS}
            value={range}
            defaultOpen={initiallyOpen}
            onValueChange={setRange}
          />
        )}
      </header>
      {state.status === 'error' && (
        <InlineNotice
          intent='warning'
          message='This chart could not load.'
          action={<RetryButton retrying={state.retrying} onRetry={onRetry} />}
        />
      )}
      {ready && (
        <ActivitySeries key={range} title={title} points={points} initialPoint={initialPoint} />
      )}
    </section>
  )
}
