'use client'

import { useCallback, useState } from 'react'
import { ChartTooltip } from '@sim/emcn/chart/tooltip'
import { usePlotInspection } from '@sim/emcn/chart/use-plot-inspection'
import { OverflowText } from '@sim/emcn/overflow-text'
import {
  formatTick,
  formatUnit,
  niceMaximum,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/format'
import type { DashboardUnit } from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/dashboards/_components/grouped-bars/grouped-bars.module.css'

interface GroupedBarsProps {
  label: string
  unit: DashboardUnit
  /** Up to six series; each keeps its color by position. */
  series: readonly string[]
  bars: readonly { label: string; values: readonly number[] }[]
}

/** One bar's width and the gap between bars in a group, in CSS pixels, when the group has room. */
const BAR = 12
const GAP = 4
/** A group's bars use at most this share of its slot, leaving space between groups. */
const GROUP_FILL = 0.8

/**
 * Bars side by side within each group, bottom-aligned on one scale, for comparing series such as
 * this period and the last. Inspection shows every series of a group in the shared chart tooltip.
 */
export function GroupedBars({ label, unit, series, bars }: GroupedBarsProps) {
  const inspection = usePlotInspection(bars.length, { band: true })
  const { active, tooltipId } = inspection
  const peak = niceMaximum(
    bars.reduce((max, bar) => Math.max(max, ...bar.values.filter(Number.isFinite)), 0),
    unit
  )
  const [plotWidth, setPlotWidth] = useState(0)
  const measure = useCallback((plot: SVGSVGElement | null) => {
    if (!plot) return
    const observer = new ResizeObserver(([entry]) => setPlotWidth(entry.contentRect.width))
    observer.observe(plot)
    return () => observer.disconnect()
  }, [])
  const count = Math.max(1, series.length)
  const natural = count * BAR + (count - 1) * GAP
  const room = plotWidth ? (plotWidth / Math.max(1, bars.length)) * GROUP_FILL : natural
  const scale = Math.min(1, room / natural)
  const barWidth = BAR * scale
  const barGap = GAP * scale
  const span = natural * scale
  const share = (value: number) =>
    Number.isFinite(value) ? Math.max(0, Math.min(100, (100 * value) / peak)) : 0
  const inspected = active === undefined ? undefined : bars[active]
  return (
    <div className={styles.chart}>
      <div className={styles.coordinates}>
        <div className={styles.scale} aria-hidden='true' data-type='T050'>
          {[peak, peak / 2, 0].map((tick) => (
            <span key={tick}>{formatTick(tick, unit)}</span>
          ))}
        </div>
        <div
          className={styles.canvas}
          role='group'
          aria-label={`${label} data`}
          aria-describedby={inspected ? tooltipId : undefined}
          tabIndex={bars.length ? 0 : undefined}
          onKeyDown={inspection.onKeyDown}
          onFocus={inspection.onFocus}
          onBlur={inspection.onBlur}
          onPointerMove={inspection.onPointerMove}
          onPointerLeave={inspection.onPointerLeave}
        >
          <svg ref={measure} className={styles.plot} role='img' aria-label={label}>
            {bars.map((bar, group) => (
              <svg
                key={bar.label}
                aria-label={bar.label}
                className={styles.group}
                data-dimmed={(active !== undefined && active !== group) || undefined}
                x={`${(100 * group) / bars.length}%`}
                width={`${100 / bars.length}%`}
                height='100%'
              >
                <svg aria-label={bar.label} x='50%' height='100%' overflow='visible'>
                  {bar.values.map((value, index) => (
                    <rect
                      key={series[index] ?? index}
                      className={styles.bar}
                      data-series={index}
                      x={index * (barWidth + barGap) - span / 2}
                      y={`${100 - share(value)}%`}
                      width={barWidth}
                      height='100%'
                      rx={Math.min(GAP, barWidth / 2)}
                    />
                  ))}
                </svg>
              </svg>
            ))}
          </svg>
          {inspected && (
            <div ref={inspection.tooltipAnchor} className={styles.tooltip}>
              <ChartTooltip
                id={tooltipId}
                heading={inspected.label}
                entries={series.map((name, index) => ({
                  label: name,
                  value: formatUnit(inspected.values[index] ?? null, unit),
                }))}
              />
            </div>
          )}
        </div>
        <ul className={styles.ticks} aria-label='Groups' data-type='T050'>
          {bars.map((bar) => (
            <li key={bar.label}>
              <OverflowText text={bar.label} />
            </li>
          ))}
        </ul>
      </div>
      <ul className={styles.legend} aria-label='Series' data-type='T052'>
        {series.map((name, index) => (
          <li key={name}>
            <i className={styles.swatch} data-series={index} />
            <OverflowText text={name} />
          </li>
        ))}
      </ul>
    </div>
  )
}
