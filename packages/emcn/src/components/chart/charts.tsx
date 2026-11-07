'use client'

import { type ReactNode, useId, useState } from 'react'
import { DonutPlot, StackPlot, TrendPlot } from '#emcn/catalog/plots'
import styles from '#emcn/components/chart/charts.module.css'
import { chartNumber, chartTick } from '#emcn/components/chart/format'
import { ChartTooltip } from '#emcn/components/chart/tooltip'
import { usePlotInspection } from '#emcn/components/chart/use-plot-inspection'
import { useScrollEdges } from '#emcn/components/scroll-area/use-scroll-edges'

interface ChartFrameProps {
  title: string
  control?: ReactNode
  children: ReactNode
}

function ChartFrame({ title, control, children }: ChartFrameProps) {
  return (
    <section aria-label={title} className={styles.chart}>
      <header className={styles.header}>
        <h2 data-type='T042'>{title}</h2>
        {control}
      </header>
      {children}
    </section>
  )
}

interface Point {
  label: string
  value: number
}
interface Bar {
  label: string
  values: readonly number[]
}

/** Past this many columns a label per column no longer fits, so the axis marks its span instead. */
const BAND_TICK_LIMIT = 12

interface SeriesFrameProps extends Omit<ChartFrameProps, 'children'> {
  labels: string[]
  maximum: number
  band?: boolean
  render: (active: number | undefined) => ReactNode
  detail: (index: number) => readonly { label: string; value: number }[]
  legend?: ReactNode
}

function SeriesFrame({
  title,
  control,
  labels,
  maximum,
  band,
  render,
  detail,
  legend,
}: SeriesFrameProps) {
  const tickEdges = useScrollEdges<HTMLLIElement>('horizontal')
  const inspection = usePlotInspection(labels.length, { band })
  const { active, tooltipId } = inspection
  const bandTicks = band && labels.length <= BAND_TICK_LIMIT
  const ticks = bandTicks
    ? labels
    : labels.filter(
        (_, i) => i === 0 || i === Math.floor((labels.length - 1) / 2) || i === labels.length - 1
      )
  return (
    <ChartFrame title={title} control={control}>
      <div className={styles.coordinates}>
        <div className={styles.scale} aria-hidden='true' data-type='T050'>
          {[maximum, maximum / 2, 0].map((n, i) => (
            <span key={i}>{labels.length ? chartTick(n) : ''}</span>
          ))}
        </div>
        <div
          className={styles.canvas}
          role='group'
          aria-label={`${title} data`}
          aria-describedby={active === undefined ? undefined : tooltipId}
          tabIndex={labels.length ? 0 : undefined}
          onKeyDown={inspection.onKeyDown}
          onFocus={inspection.onFocus}
          onBlur={inspection.onBlur}
          onPointerLeave={inspection.onPointerLeave}
          onPointerMove={inspection.onPointerMove}
        >
          {render(active)}
          {active !== undefined && (
            <div ref={inspection.tooltipAnchor} className={styles.tooltip}>
              <ChartTooltip id={tooltipId} heading={labels[active]} entries={detail(active)} />
            </div>
          )}
        </div>
        <ul
          className={styles.ticks}
          aria-label='Chart periods'
          data-band={bandTicks || undefined}
          data-type='T050'
        >
          {ticks.map((tick, i) => (
            <li ref={tickEdges} key={i} title={tick}>
              {tick}
            </li>
          ))}
        </ul>
      </div>
      {legend}
    </ChartFrame>
  )
}

interface TrendChartProps extends Omit<ChartFrameProps, 'children'> {
  points: readonly Point[]
  maximum?: number
}

export function TrendChart({ title, control, points, maximum = 0 }: TrendChartProps) {
  const data = points.filter((point) => Number.isFinite(point.value) && point.value >= 0)
  const values = data.map((point) => point.value)
  const peak = values.reduce((a, b) => Math.max(a, b), Math.max(1, maximum || 0))
  return (
    <SeriesFrame
      title={title}
      control={control}
      labels={data.map((p) => p.label)}
      maximum={peak}
      detail={(i) => [{ label: title, value: values[i] }]}
      render={(active) => (
        <TrendPlot label={title} values={values} maximum={peak} active={active} />
      )}
    />
  )
}

interface BarChartProps extends Omit<ChartFrameProps, 'children'> {
  bars: readonly Bar[]
  /** Layer names, bottom-up, up to six. A series keeps its color by position. */
  series: readonly string[]
  maximum?: number
  /** Leave a layer with no values out of the legend and the tooltip. */
  hideEmptySeries?: boolean
  /** A figure beside a layer's legend entry, keyed by its name. */
  seriesTotals?: Readonly<Record<string, string>>
}

export function BarChart({
  title,
  control,
  bars,
  series,
  maximum = 0,
  hideEmptySeries,
  seriesTotals,
}: BarChartProps) {
  const data = bars.filter((bar) => bar.values.every((n) => Number.isFinite(n) && n >= 0))
  const values = data.map((bar) => bar.values)
  const peak = values.reduce(
    (n, layers) =>
      Math.max(
        n,
        layers.reduce((sum, value) => sum + value, 0)
      ),
    Math.max(1, maximum || 0)
  )
  const legend = series
    .map((label, layer) => ({ label, layer }))
    .filter(({ layer }) => !hideEmptySeries || values.some((row) => row[layer] > 0))
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  if (selected !== null && !legend.some((item) => item.label === selected)) setSelected(null)
  if (hovered !== null && !legend.some((item) => item.label === hovered)) setHovered(null)
  const highlighted = legend.find((item) => item.label === (hovered ?? selected))?.layer
  return (
    <SeriesFrame
      title={title}
      control={control}
      labels={data.map((b) => b.label)}
      maximum={peak}
      band
      detail={(i) =>
        series
          .map((label, j) => ({ label, value: values[i][j] }))
          .filter((entry) => !hideEmptySeries || entry.value > 0)
      }
      legend={
        <ul className={styles.series} aria-label='Bar series'>
          {legend.map(({ label, layer }) => (
            <li
              key={label}
              data-dimmed={(highlighted !== undefined && highlighted !== layer) || undefined}
            >
              <button
                type='button'
                data-type='T052'
                aria-label={`Highlight ${label}`}
                aria-pressed={selected === label}
                onPointerEnter={() => setHovered(label)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(label)}
                onBlur={() => setHovered(null)}
                onClick={() => setSelected(selected === label ? null : label)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setHovered(null)
                    setSelected(null)
                  }
                }}
              >
                <i className={styles.swatch} data-bar={layer} />
                {label}
                {seriesTotals?.[label] && (
                  <span className={styles.seriesTotal}>{seriesTotals[label]}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      }
      render={() => (
        <StackPlot label={title} values={values} maximum={peak} highlighted={highlighted} />
      )}
    />
  )
}

interface DonutChartProps extends Omit<ChartFrameProps, 'children'> {
  segments: readonly Point[]
  totalLabel: string
}

export function DonutChart({ title, control, segments, totalLabel }: DonutChartProps) {
  const [active, setActive] = useState<number | null>(null)
  const id = useId()
  const data = segments.filter((entry) => Number.isFinite(entry.value) && entry.value >= 0)
  const total = data.reduce((sum, p) => sum + p.value, 0)
  const selected = active === null ? undefined : data[active]
  return (
    <ChartFrame title={title} control={control}>
      <div className={styles.distribution}>
        <div className={styles.ring}>
          <DonutPlot label={title} values={data.map((d) => d.value)} onInspect={setActive} />
          <div className={styles.total}>
            <span data-type='T024'>{data.length ? chartNumber.format(total) : '—'}</span>
            <span data-type='T050'>{totalLabel}</span>
          </div>
          {selected && (
            <div className={styles.tooltip}>
              <ChartTooltip
                id={id}
                heading={selected.label}
                entries={[{ label: totalLabel, value: selected.value }]}
              />
            </div>
          )}
        </div>
        <ul className={styles.legend} aria-label='Distribution legend'>
          {data.map(({ label, value }, i) => (
            <li key={label}>
              <button
                type='button'
                className={styles.legendItem}
                data-active={i === active || undefined}
                aria-describedby={i === active ? id : undefined}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                onClick={() => setActive(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setActive(null)
                }}
              >
                <i className={styles.swatch} data-palette={i % 4} />
                <span data-type='T060'>{label}</span>
                <span className={styles.share} data-type='T050'>
                  {(total ? (100 * value) / total : 0).toFixed(1)}%
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </ChartFrame>
  )
}
