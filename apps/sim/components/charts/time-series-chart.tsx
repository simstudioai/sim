'use client'

import { useRef, useState } from 'react'
import { cn, scrollFadeAttributes, scrollFadeXClass, useScrollEdges } from '@sim/emcn'
import { EChartsView } from '@/components/charts/echarts-view'
import {
  bindTimeSeriesInteractions,
  type ChartReadout,
  type TimeSeriesInteractionOptions,
} from '@/lib/charts/time-series'
import { dashboardTimeLabel } from '@/lib/dashboards/time'

interface TimeSeriesChartProps extends Omit<TimeSeriesInteractionOptions, 'onReadout'> {
  label: string
  option: Record<string, unknown>
}

export function TimeSeriesChart({ label, option, ...config }: TimeSeriesChartProps) {
  const valuesRef = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(valuesRef, { axis: 'x' })
  const [readout, setReadout] = useState<ChartReadout | null>(null)
  return (
    <div className='h-full min-w-0'>
      <div
        className='mb-2 flex h-8 min-w-0 items-center justify-between gap-4 text-sm tabular-nums'
        aria-label={`${label} values`}
      >
        <div
          ref={valuesRef}
          className={cn('min-w-0 overflow-x-auto whitespace-nowrap', scrollFadeXClass)}
          {...scrollFadeAttributes(edges)}
        >
          <div className='flex w-max items-center gap-4'>
            {readout?.values.map((entry, index) => (
              <span key={index} className='inline-flex items-center gap-1.5'>
                <svg
                  viewBox='0 0 8 8'
                  aria-hidden='true'
                  className='size-2 shrink-0 text-[var(--text-body)]'
                >
                  <circle cx='4' cy='4' r='3' fill={entry.color ?? 'currentColor'} />
                </svg>
                <span className='text-[var(--text-tertiary)]'>{entry.name}:</span>
                <span className='text-[var(--text-body)]'>{entry.value}</span>
                {entry.summary && <span className='text-[var(--text-muted)]'>{entry.summary}</span>}
              </span>
            ))}
          </div>
        </div>
        {readout?.time != null && (
          <span className='shrink-0 whitespace-nowrap text-[var(--text-muted)]'>
            {dashboardTimeLabel(readout.time, config.timeZone)}
          </span>
        )}
      </div>
      <EChartsView
        label={label}
        option={option}
        className='h-[240px]'
        revision={JSON.stringify({
          ...config.range,
          timeZone: config.timeZone,
          zoomEnabled: Boolean(config.onZoom),
          columnLabels: config.columnLabels,
          firstTime: config.firstTime,
        })}
        createController={(chart) =>
          bindTimeSeriesInteractions(chart, {
            ...config,
            onReadout: (next) =>
              setReadout((previous) =>
                JSON.stringify(previous) === JSON.stringify(next) ? previous : next
              ),
          })
        }
      />
    </div>
  )
}
