/** @vitest-environment jsdom */
import type { EChartsType } from 'echarts'
import { describe, expect, it, vi } from 'vitest'
import { bindTimeSeriesInteractions, readTimeSeriesTooltip } from '@/lib/charts/time-series'
import { createDashboardCursorStore } from '@/stores/dashboards/cursor'

const range = { from: '2026-09-20T00:00:00.000Z', to: '2026-09-22T00:00:00.000Z' }
const time = Date.parse('2026-09-21T00:00:00Z')
function makeChart(id: string) {
  const handlers = new Map<string, (event: unknown) => void>()
  const chart = {
    getId: () => id,
    getDom: () => document.createElement('div'),
    getHeight: () => 220,
    convertToPixel: vi.fn((_finder: unknown, value: number) => value / 10000),
    dispatchAction: vi.fn((action: Record<string, unknown>) => {
      if (action.type === 'updateAxisPointer')
        handlers.get('updateAxisPointer')?.({ axesInfo: [{ axisDim: 'x', value: time }] })
      if (action.type === 'hideTip') handlers.get('hideTip')?.({})
    }),
    on: (name: string, handler: (event: unknown) => void) => handlers.set(name, handler),
    off: (name: string) => handlers.delete(name),
  }
  return { chart, instance: chart as unknown as EChartsType, handlers }
}

describe('time chart interactions', () => {
  it('reads the resolved dataset encodings, authored names/colors, and null values', () => {
    expect(
      readTimeSeriesTooltip(
        [
          {
            axisValue: time,
            seriesName: 'CPU',
            color: '#2563eb',
            encode: { y: [1] },
            dimensionNames: ['timestamp', 'cpu'],
            value: { timestamp: time, cpu: 42 },
          },
          {
            axisValue: time,
            seriesName: 'series\u00000',
            color: '#16a34a',
            encode: { y: [1] },
            dimensionNames: ['timestamp', 'memory'],
            value: [time, null],
          },
        ],
        { memory: 'Memory' }
      )
    ).toEqual({
      time,
      values: [
        { name: 'CPU', value: '42', color: '#2563eb' },
        { name: 'Memory', value: '—', color: '#16a34a' },
      ],
    })
  })
  it('preserves authored styling while installing trusted interaction handlers', () => {
    const { instance } = makeChart('one')
    const controller = bindTimeSeriesInteractions(instance, {
      range,
      timeZone: 'UTC',
      cursorStore: createDashboardCursorStore(),
      columnLabels: {},
      firstTime: time,
      onReadout: vi.fn(),
      onZoom: vi.fn(),
    })
    const option = controller.prepareOption({
      color: ['red'],
      xAxis: { type: 'time', axisLabel: { formatter: '{MMM}' } },
      series: [{ type: 'line', lineStyle: { width: 3, color: 'blue' } }],
    })
    expect(option).toMatchObject({
      color: ['red'],
      xAxis: { axisLabel: { formatter: '{MMM}' } },
      series: [{ lineStyle: { width: 3, color: 'blue' } }],
      toolbox: { show: false },
      tooltip: { renderMode: 'richText' },
    })
    controller.dispose()
  })
  it('shows timestamp and decimal values only in the hovered chart tooltip', () => {
    const { instance } = makeChart('one')
    const store = createDashboardCursorStore()
    const onReadout = vi.fn()
    const controller = bindTimeSeriesInteractions(instance, {
      range,
      timeZone: 'America/Los_Angeles',
      cursorStore: store,
      columnLabels: {},
      firstTime: time,
      onReadout,
    })
    const option = controller.prepareOption({
      xAxis: { type: 'time' },
      yAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
      series: [{ type: 'line' }],
    })
    const tooltip = option.tooltip as { formatter: (params: unknown) => string }
    const params = [
      {
        axisValue: time,
        seriesIndex: 0,
        seriesName: 'Resolved',
        dimensionNames: ['timestamp', 'rate'],
        encode: { y: [1] },
        value: { timestamp: time, rate: 71.63 },
      },
    ]
    store.getState().setCursor({ owner: 'one', group: `${range.from}/${range.to}`, time })
    expect(tooltip.formatter(params)).toBe('Sep 20, 17:00 PDT\nResolved: 71.63%')
    store.getState().setCursor({ owner: 'other', group: `${range.from}/${range.to}`, time })
    expect(tooltip.formatter(params)).toBe('')
    expect(onReadout).toHaveBeenLastCalledWith(expect.objectContaining({ time }))
    controller.dispose()
    expect(tooltip.formatter(params)).toBe('')
  })
  it('synchronizes by timestamp without feedback loops, isolates other ranges, and cleans up', () => {
    const store = createDashboardCursorStore()
    const first = makeChart('one')
    const second = makeChart('two')
    const third = makeChart('override')
    const config = {
      range,
      timeZone: 'UTC',
      cursorStore: store,
      columnLabels: {},
      firstTime: time,
      onReadout: vi.fn(),
    }
    const bindings = [
      bindTimeSeriesInteractions(first.instance, config),
      bindTimeSeriesInteractions(second.instance, config),
      bindTimeSeriesInteractions(third.instance, {
        ...config,
        range: { ...range, from: '2026-09-21T00:00:00Z' },
      }),
    ]
    first.handlers.get('updateAxisPointer')?.({ axesInfo: [{ axisDim: 'x', value: time }] })
    expect(store.getState().cursor?.owner).toBe('one')
    expect(second.chart.dispatchAction).toHaveBeenCalledTimes(1)
    expect(second.chart.dispatchAction).toHaveBeenCalledWith({
      type: 'updateAxisPointer',
      x: time / 10000,
      y: 110,
    })
    expect(third.chart.dispatchAction).not.toHaveBeenCalledWith(
      expect.objectContaining({ x: time / 10000, type: 'updateAxisPointer' })
    )
    first.handlers.get('hideTip')?.({})
    expect(store.getState().cursor).toBeNull()
    bindings.forEach((binding) => binding.dispose())
    expect(second.handlers.size).toBe(0)
    second.chart.dispatchAction.mockClear()
    store.getState().setCursor({ owner: 'other', group: `${range.from}/${range.to}`, time })
    expect(second.chart.dispatchAction).not.toHaveBeenCalled()
  })
  it('queries only after a meaningful completed brush, clears it, and ignores clicks', () => {
    const { instance, handlers, chart } = makeChart('one')
    const onZoom = vi.fn()
    const controller = bindTimeSeriesInteractions(instance, {
      range,
      timeZone: 'UTC',
      cursorStore: createDashboardCursorStore(),
      columnLabels: {},
      firstTime: time,
      onReadout: vi.fn(),
      onZoom,
    })
    expect(handlers.has('brush')).toBe(false)
    handlers.get('brushEnd')?.({ areas: [{ coordRange: [time, time + 3600000], range: [30, 31] }] })
    expect(onZoom).not.toHaveBeenCalled()
    handlers.get('brushEnd')?.({ areas: [{ coordRange: [time + 3600000, time], range: [80, 30] }] })
    expect(onZoom).toHaveBeenCalledExactlyOnceWith({
      from: '2026-09-21T00:00:00.000Z',
      to: '2026-09-21T01:00:00.000Z',
    })
    expect(chart.dispatchAction).toHaveBeenCalledWith({ type: 'brush', areas: [] })
    controller.dispose()
  })
})
