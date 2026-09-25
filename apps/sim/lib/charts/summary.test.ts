/** @vitest-environment jsdom */
import * as echarts from 'echarts'
import { describe, expect, it, vi } from 'vitest'
import { chartSummaryExtension, observeChartSummary, summarizeChart } from '@/lib/charts/summary'
import { bindTimeSeriesInteractions, type ChartReadout } from '@/lib/charts/time-series'
import { createDashboardCursorStore } from '@/stores/dashboards/cursor'

echarts.setPlatformAPI({ measureText: (text) => ({ width: String(text).length * 6 }) })
echarts.use(chartSummaryExtension)

function makeChart() {
  return echarts.init(
    document.createElement('div'),
    {},
    { renderer: 'svg', ssr: true, width: 600, height: 300 }
  )
}

describe('resolved chart summaries', () => {
  it('averages percentages, totals counts after transforms, and preserves series colors and names', () => {
    const chart = makeChart()
    let summary: ChartReadout | null = null
    const stop = observeChartSummary(chart, (model) => {
      summary = summarizeChart(model, {})
    })
    chart.setOption({
      animation: false,
      dataset: [
        {
          source: [
            { time: '2026-09-20', cpu: 20, count: 2 },
            { time: '2026-09-21', cpu: 80, count: 8 },
            { time: '2026-09-22', cpu: null, count: 0 },
            { time: '2026-09-23', cpu: 100, count: 100 },
          ],
        },
        { transform: { type: 'filter', config: { dimension: 'count', lt: 100 } } },
      ],
      xAxis: { type: 'time' },
      yAxis: [{ type: 'value', axisLabel: { formatter: '{value}%' } }, { type: 'value' }],
      series: [
        {
          name: 'CPU',
          type: 'line',
          datasetIndex: 1,
          encode: { x: 'time', y: 'cpu' },
          itemStyle: { color: '#123456' },
        },
        {
          name: 'Reports',
          type: 'line',
          datasetIndex: 1,
          yAxisIndex: 1,
          encode: { x: 'time', y: 'count' },
          itemStyle: { color: '#654321' },
        },
      ],
    })
    expect(summary).toEqual({
      time: null,
      values: [
        { name: 'CPU', value: '50%', color: '#123456', summary: 'Avg' },
        { name: 'Reports', value: '10', color: '#654321', summary: 'Total' },
      ],
    })
    stop()
    chart.dispose()
  })

  it('keeps missing data distinct from actual zero and excludes hidden legend series', () => {
    const chart = makeChart()
    const read = vi.fn()
    const stop = observeChartSummary(chart, (model) => read(summarizeChart(model, {})))
    chart.setOption({
      animation: false,
      legend: { selected: { Hidden: false } },
      xAxis: { type: 'time' },
      yAxis: { axisLabel: { formatter: '{value}%' } },
      series: [
        {
          name: 'Zero',
          type: 'line',
          data: [
            ['2026-09-20', 0],
            ['2026-09-21', null],
          ],
        },
        { name: 'Missing', type: 'line', data: [['2026-09-20', null]] },
        { name: 'Hidden', type: 'line', data: [['2026-09-20', 100]] },
      ],
    })
    expect(
      read.mock.lastCall![0].values.map(({ name, value }: { name: string; value: string }) => ({
        name,
        value,
      }))
    ).toEqual([
      { name: 'Zero', value: '0%' },
      { name: 'Missing', value: '—' },
    ])
    stop()
    read.mockClear()
    chart.resize({ width: 700 })
    expect(read).not.toHaveBeenCalled()
    chart.dispose()
  })

  it('restores a summary after hover and recomputes it on new data', () => {
    const chart = makeChart()
    const onReadout = vi.fn()
    const controller = bindTimeSeriesInteractions(chart, {
      range: { from: '2026-09-20T00:00:00Z', to: '2026-09-22T00:00:00Z' },
      firstTime: Date.parse('2026-09-20'),
      timeZone: 'UTC',
      columnLabels: {},
      cursorStore: createDashboardCursorStore(),
      onReadout,
    })
    const option = (value: number) =>
      controller.prepareOption({
        animation: false,
        xAxis: { type: 'time' },
        yAxis: {},
        series: [
          {
            name: 'Reports',
            type: 'line',
            data: [
              ['2026-09-20', value],
              ['2026-09-21', 3],
            ],
          },
        ],
      })
    chart.setOption(option(2))
    controller.afterUpdate()
    expect(onReadout.mock.lastCall![0]).toMatchObject({
      time: null,
      values: [{ value: '5', summary: 'Total' }],
    })
    chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: 0 })
    chart.dispatchAction({ type: 'hideTip' })
    expect(onReadout.mock.lastCall![0].values[0].value).toBe('5')
    chart.setOption(option(7), { notMerge: true })
    controller.afterUpdate()
    expect(onReadout.mock.lastCall![0].values[0].value).toBe('10')
    controller.dispose()
    chart.dispose()
  })
})
