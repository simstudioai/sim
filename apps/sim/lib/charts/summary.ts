import { toRecord } from '@sim/utils/object'
import type { EChartsType, registerUpdateLifecycle } from 'echarts'
import type { ChartReadout, ChartReadoutValue } from '@/lib/charts/time-series'

type ChartModel = Parameters<Parameters<typeof registerUpdateLifecycle<'afterupdate'>>[1]>[0]
const listeners = new WeakMap<HTMLElement, (model: ChartModel) => void>()

/** ECharts' extension lifecycle exposes the resolved series, including dataset transforms. */
export function chartSummaryExtension(registers: {
  registerUpdateLifecycle: typeof registerUpdateLifecycle
}) {
  registers.registerUpdateLifecycle('afterupdate', (model, api) => {
    listeners.get(api.getDom())?.(model)
  })
}

export function observeChartSummary(chart: EChartsType, listener: (model: ChartModel) => void) {
  const element = chart.getDom()
  listeners.set(element, listener)
  return () => {
    if (listeners.get(element) === listener) listeners.delete(element)
  }
}

export function formatChartValue(value: unknown, formatter?: string): string {
  if (value == null || value === '-' || (typeof value === 'number' && !Number.isFinite(value)))
    return '—'
  const text =
    typeof value === 'number'
      ? value.toLocaleString(undefined, { maximumFractionDigits: 2 })
      : String(value)
  return formatter?.includes('{value}') ? formatter.replaceAll('{value}', text) : text
}

/** Summaries use original plotted samples, before display sampling or stacking. Missing samples stay missing. */
export function summarizeChart(model: ChartModel, labels: Record<string, string>): ChartReadout {
  const values: ChartReadoutValue[] = []
  model.eachSeries((series) => {
    if (series.get('coordinateSystem') !== 'cartesian2d') return
    const data = series.getRawData()
    const axis = model.getComponent('yAxis', Number(toRecord(series.option).yAxisIndex ?? 0))
    const format = toRecord(toRecord(axis?.option).axisLabel).formatter
    const formatter = typeof format === 'string' ? format : undefined
    const percentage = formatter?.includes('%') ?? false
    const style = toRecord(series.getData().getVisual('style'))
    const color = style.fill ?? style.stroke
    for (const dimension of data.mapDimensionsAll('y')) {
      let sum = 0
      let count = 0
      for (let index = 0; index < data.count(); index++) {
        const value = data.get(dimension, index)
        if (typeof value === 'number' && Number.isFinite(value)) {
          sum += value
          count++
        }
      }
      const name =
        series.name && !series.name.includes('\u0000')
          ? series.name
          : (labels[dimension] ?? dimension)
      values.push({
        name,
        value: formatChartValue(count ? (percentage ? sum / count : sum) : null, formatter),
        color: typeof color === 'string' ? color : null,
        summary: percentage ? 'Avg' : 'Total',
      })
    }
  })
  return { time: null, values }
}
