'use client'

import { useCallback, useState } from 'react'
import { ChartTooltip } from '@sim/emcn/chart/tooltip'
import { usePlotInspection } from '@sim/emcn/chart/use-plot-inspection'
import { OverflowText } from '@sim/emcn/overflow-text'
import {
  formatTick,
  formatUnit,
  niceMaximum,
} from '@/app/(product)/_components/workspace/workspace-session/format'
import type { DashboardUnit } from '@/app/(product)/_components/workspace/workspace-session/model'
import styles from '@/app/(product)/workspace/[workspaceId]/dashboards/_components/grouped-bars/grouped-bars.module.css'

interface GroupedBarsProps {
  label: string
  unit: DashboardUnit
  /** Up to six series; each keeps its color by position. */
  series: readonly string[]
  bars: readonly { label: string; values: readonly number[] }[]
}

/** One bar's width when the group has room, and the fixed gap between a group's bars, in CSS px. */
const BAR = 12
const GAP = 4
/** The thinnest bar drawn when a narrow chart shares its slot among many series. */
const MIN_BAR = 2
/** A group's bars use at most this share of its slot, leaving space between groups. */
const GROUP_FILL = 0.8
/** Past this many groups a label per group no longer fits, so the axis marks its span instead. */
const BAND_TICK_LIMIT = 12

/**
 * Bars side by side within each group, bottom-aligned on one scale, for comparing series such as
 * this period and the last. Inspection shows every series of a group in the shared chart tooltip;
 * the legend highlights a series, as the shared stacked chart's does.
 */
export function GroupedBars({ label, unit, series, bars }: GroupedBarsProps) {
  const inspection = usePlotInspection(bars.length, { band: true })
  const { active, tooltipId } = inspection
  const [hovered, setHovered] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const highlighted = hovered ?? selected
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
  const gaps = (count - 1) * GAP
  const room = plotWidth ? (plotWidth / Math.max(1, bars.length)) * GROUP_FILL : count * BAR + gaps
  // The gap holds at 4px; bars give up width first, down to a hairline.
  const barWidth = Math.max(MIN_BAR, Math.min(BAR, (room - gaps) / count))
  const span = count * barWidth + gaps
  const share = (value: number) =>
    Number.isFinite(value) ? Math.max(0, Math.min(100, (100 * value) / peak)) : 0
  const inspected = active === undefined ? undefined : bars[active]
  const banded = bars.length <= BAND_TICK_LIMIT
  const ticks = banded
    ? bars.map((bar, index) => ({ label: bar.label, index }))
    : [0, Math.floor((bars.length - 1) / 2), bars.length - 1].map((index) => ({
        label: bars[index]?.label ?? '',
        index,
      }))
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
                key={`${group}-${bar.label}`}
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
                      key={`${index}-${series[index] ?? ''}`}
                      className={styles.bar}
                      data-series={index}
                      data-faded={(highlighted !== null && highlighted !== index) || undefined}
                      x={index * (barWidth + GAP) - span / 2}
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
        <ul
          className={styles.ticks}
          aria-label='Groups'
          data-type='T050'
          data-banded={banded || undefined}
        >
          {ticks.map((tick) => (
            <li key={`${tick.index}-${tick.label}`}>
              <OverflowText text={tick.label}>{tick.label}</OverflowText>
            </li>
          ))}
        </ul>
      </div>
      <ul className={styles.legend} aria-label='Series'>
        {series.map((name, index) => (
          <li
            key={`${index}-${name}`}
            data-dimmed={(highlighted !== null && highlighted !== index) || undefined}
          >
            <button
              type='button'
              data-type='T052'
              aria-label={`Highlight ${name}`}
              aria-pressed={selected === index}
              onPointerEnter={() => setHovered(index)}
              onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered(null)}
              onClick={() => setSelected(selected === index ? null : index)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  setHovered(null)
                  setSelected(null)
                }
              }}
            >
              <i className={styles.swatch} data-series={index} />
              <OverflowText text={name}>{name}</OverflowText>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
