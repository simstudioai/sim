import { isRecordLike, toRecord } from '@sim/utils/object'
import type { EChartsType } from 'echarts'
import type { EChartsController } from '@/components/charts/echarts-view'
import { formatChartValue, observeChartSummary, summarizeChart } from '@/lib/charts/summary'
import {
  type DashboardTimeRange,
  dashboardAxisFormatter,
  dashboardTimeLabel,
  dashboardZoomRange,
} from '@/lib/dashboards/time'
import type { DashboardCursorStore } from '@/stores/dashboards/cursor'

export interface ChartReadoutValue {
  name: string
  value: string
  color: string | null
  summary?: 'Avg' | 'Total'
}
export interface ChartReadout {
  time: number | null
  values: ChartReadoutValue[]
}
export interface TimeSeriesInteractionOptions {
  range: DashboardTimeRange
  timeZone: string
  cursorStore: DashboardCursorStore
  columnLabels: Record<string, string>
  firstTime: number | null
  onReadout: (readout: ChartReadout | null) => void
  onZoom?: (range: DashboardTimeRange) => void
}

/** Cartesian charts with one horizontal time axis share dashboard interactions. */
export function isTimeSeriesOption(option: Record<string, unknown>): boolean {
  const axes = Array.isArray(option.xAxis) ? option.xAxis : [option.xAxis]
  return axes.length === 1 && toRecord(axes[0]).type === 'time'
}

/** Use ECharts' resolved encodings and colors, including transformed datasets. */
export function readTimeSeriesTooltip(
  params: unknown,
  columnLabels: Record<string, string>,
  formatters: Record<number, string> = {}
): ChartReadout | null {
  const entries = (Array.isArray(params) ? params : [params]).filter(isRecordLike)
  if (entries[0]?.axisValue == null) return null
  const time = Number(entries[0]?.axisValue)
  if (!Number.isFinite(time) || entries.length === 0) return null
  const values = entries.flatMap((entry): ChartReadoutValue[] => {
    const dimensions = Array.isArray(entry.dimensionNames) ? entry.dimensionNames : []
    const encoded = toRecord(entry.encode).y
    const indices = Array.isArray(encoded) ? encoded : []
    return indices.map((index) => {
      const field = typeof index === 'number' ? dimensions[index] : undefined
      const value = Array.isArray(entry.value)
        ? entry.value[index]
        : isRecordLike(entry.value) && typeof field === 'string'
          ? entry.value[field]
          : entry.value
      const seriesName =
        typeof entry.seriesName === 'string' && !entry.seriesName.includes('\u0000')
          ? entry.seriesName
          : null
      return {
        name: seriesName || (typeof field === 'string' ? (columnLabels[field] ?? field) : 'Value'),
        value: formatChartValue(value, formatters[Number(entry.seriesIndex)]),
        color: typeof entry.color === 'string' ? entry.color : null,
      }
    })
  })
  return { time, values }
}

/** Trusted event handlers wrap sanitized ECharts options; documents never contain executable code. */
export function bindTimeSeriesInteractions(
  chart: EChartsType,
  config: TimeSeriesInteractionOptions
): EChartsController {
  const { range, cursorStore, timeZone } = config
  const group = `${range.from}/${range.to}`
  const owner = chart.getId()
  let internal = false
  let disposed = false
  let summary: ChartReadout | null = null
  const formatters: Record<number, string> = {}
  const stopSummary = observeChartSummary(chart, (model) => {
    summary = summarizeChart(model, config.columnLabels)
    if (cursorStore.getState().cursor?.group !== group) config.onReadout(summary)
  })
  const runInternal = (action: () => void) => {
    internal = true
    try {
      action()
    } finally {
      internal = false
    }
  }
  const pointAt = (time: number) => ({
    x: chart.convertToPixel({ xAxisIndex: 0 }, time),
    y: chart.getHeight() / 2,
  })
  const showSummary = () =>
    runInternal(() => {
      chart.dispatchAction({ type: 'hideTip' })
      chart.dispatchAction({ type: 'updateAxisPointer', currTrigger: 'leave' })
      config.onReadout(summary)
    })
  const sync = () => {
    const cursor = cursorStore.getState().cursor
    if (cursor?.owner === owner) return
    if (cursor?.group === group) {
      runInternal(() =>
        chart.dispatchAction({ type: 'updateAxisPointer', ...pointAt(cursor.time) })
      )
    } else showSummary()
  }
  const onPointer = (event: unknown) => {
    if (internal || disposed) return
    const axes = toRecord(event).axesInfo
    const x = Array.isArray(axes) ? axes.find((axis) => toRecord(axis).axisDim === 'x') : null
    const time = toRecord(x).value
    if (typeof time === 'number' && Number.isFinite(time)) {
      cursorStore.getState().setCursor({ owner, group, time })
    }
  }
  const onLeave = () => {
    if (internal || disposed) return
    cursorStore.getState().clearCursor(owner)
    showSummary()
  }
  const clearBrush = () => chart.dispatchAction({ type: 'brush', areas: [] })
  const onBrushEnd = (event: unknown) => {
    if (disposed || !config.onZoom) return
    const areas = toRecord(event).areas
    const area = Array.isArray(areas) ? toRecord(areas[0]) : {}
    const pixels = area.range
    const zoom = dashboardZoomRange(area.coordRange, range)
    clearBrush()
    if (!zoom || !Array.isArray(pixels) || Math.abs(pixels[1] - pixels[0]) < 6) return
    cursorStore.getState().clearCursor()
    config.onZoom(zoom)
  }
  const unsubscribe = cursorStore.subscribe((state, previous) => {
    if (state.cursor?.group === group || previous.cursor?.group === group) sync()
  })
  chart.on('updateAxisPointer', onPointer)
  chart.on('hideTip', onLeave)
  chart.on('brushEnd', onBrushEnd)
  return {
    prepareOption(option) {
      const yAxes = Array.isArray(option.yAxis) ? option.yAxis : [option.yAxis]
      const series = Array.isArray(option.series) ? option.series : [option.series]
      series.forEach((entry, index) => {
        const yAxis = toRecord(yAxes[Number(toRecord(entry).yAxisIndex ?? 0)])
        const formatter = toRecord(yAxis.axisLabel).formatter
        if (typeof formatter === 'string') formatters[index] = formatter
      })
      const axis = toRecord(Array.isArray(option.xAxis) ? option.xAxis[0] : option.xAxis)
      const axisLabel = toRecord(axis.axisLabel)
      const styles = getComputedStyle(chart.getDom())
      option.useUTC = true
      option.animationDurationUpdate ??= 0
      option.xAxis = {
        min: Math.min(Date.parse(range.from), config.firstTime ?? Number.POSITIVE_INFINITY),
        max: Date.parse(range.to),
        ...axis,
        axisLabel: { formatter: dashboardAxisFormatter(range, timeZone), ...axisLabel },
      }
      option.tooltip = {
        ...toRecord(option.tooltip),
        trigger: 'axis',
        show: true,
        showContent: true,
        renderMode: 'richText',
        axisPointer: { type: 'line', snap: true, label: { show: false } },
        formatter: (params: unknown) => {
          if (disposed) return ''
          const readout = readTimeSeriesTooltip(params, config.columnLabels, formatters)
          config.onReadout(readout)
          const cursor = cursorStore.getState().cursor
          if (readout?.time == null || (cursor?.group === group && cursor.owner !== owner))
            return ''
          return [
            dashboardTimeLabel(readout.time, timeZone),
            ...readout.values.map((entry) => `${entry.name}: ${entry.value}`),
          ].join('\n')
        },
      }
      if (config.onZoom) {
        option.toolbox = { show: false }
        option.brush = {
          xAxisIndex: 0,
          brushType: 'lineX',
          brushMode: 'single',
          transformable: false,
          seriesIndex: [],
          removeOnClick: true,
          brushStyle: {
            color: styles.getPropertyValue('--text-body').trim(),
            borderColor: styles.getPropertyValue('--text-body').trim(),
            borderWidth: 1,
            opacity: 0.12,
          },
        }
      }
      return option
    },
    afterUpdate() {
      if (config.onZoom)
        chart.dispatchAction({
          type: 'takeGlobalCursor',
          key: 'brush',
          brushOption: { brushType: 'lineX', brushMode: 'single' },
        })
      sync()
    },
    dispose() {
      disposed = true
      stopSummary()
      unsubscribe()
      chart.off('updateAxisPointer', onPointer)
      chart.off('hideTip', onLeave)
      chart.off('brushEnd', onBrushEnd)
      cursorStore.getState().clearCursor(owner)
    },
  }
}
