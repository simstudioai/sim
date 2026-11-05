'use client'

import { useState } from 'react'
import styles from '@/platform/app/(shell)/home/_components/tasks-chart/tasks-chart.module.css'
import { TrendPlot } from '@/platform/design-system/catalog/plots'
import { chartNumber, chartTick } from '@/platform/design-system/components/chart/chart-format'
import { ChartTooltip } from '@/platform/design-system/components/chart/chart-tooltip'
import { usePlotInspection } from '@/platform/design-system/components/chart/use-plot-inspection'
import { RangePicker } from '@/platform/design-system/components/menu/range-picker'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'

interface TaskPoint {
  label: string
  value: number
}

interface TasksRunChartProps {
  title: string
  ranges: readonly { label: string; points: readonly TaskPoint[] }[]
  initialPoint?: number
  initiallyOpen?: boolean
}

interface TaskSeriesProps {
  title: string
  points: readonly TaskPoint[]
  initialPoint?: number
}

function TaskSeries({ title, points, initialPoint }: TaskSeriesProps) {
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
        data-plot='tasks-run'
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
              heading={point.label}
              entries={[{ label: title, value: point.value }]}
            />
          </div>
        )}
      </div>
      <ul className={styles.ticks} aria-label='Chart periods' data-type='T034'>
        {labels.map((label) => (
          <li ref={tickEdges} key={label.label}>
            {label.label}
          </li>
        ))}
      </ul>
    </div>
  )
}

export function TasksRunChart({ title, ranges, initialPoint, initiallyOpen }: TasksRunChartProps) {
  const [selection, setSelection] = useState(ranges[0]?.label)
  const range = ranges.find((item) => item.label === selection) ?? ranges[0]
  const points = (range?.points ?? []).filter(
    (point) => Number.isFinite(point.value) && point.value >= 0
  )
  const total = points.reduce((sum, point) => sum + point.value, 0)
  return (
    <section className={styles.chart} aria-label={title}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2 data-type='T042'>{title}</h2>
          <span className={styles.total} data-type='T076'>
            {chartNumber.format(total)}
          </span>
        </div>
        <RangePicker
          label='Range'
          options={ranges.map((item) => item.label)}
          defaultValue={range?.label}
          defaultOpen={initiallyOpen}
          onValueChange={setSelection}
        />
      </header>
      <TaskSeries key={range?.label} title={title} points={points} initialPoint={initialPoint} />
    </section>
  )
}
