import { describe, expect, it } from 'vitest'
import { applyChartAnnotations, CHART_ANNOTATION_SERIES_ID } from '@/lib/charts/annotations'

const palette = { tones: { neutral: 'grey', error: 'red', info: 'blue' } }
const timeSeries = {
  xAxis: { type: 'time' },
  yAxis: { type: 'value' },
  series: [{ type: 'line' }, { type: 'line' }],
}
type Series = Record<string, unknown>

describe('chart annotations', () => {
  it('draws marks under the first series and their labels on a series above', () => {
    const option = applyChartAnnotations(
      timeSeries,
      {
        highlights: [
          {
            from: '2026-08-21T00:00:00.000Z',
            to: '2026-09-07T00:00:00.000Z',
            label: 'Outage',
            tone: 'error',
          },
          { at: '2026-09-10T14:00:00.000Z', tone: 'info' },
        ],
        thresholds: [{ value: 50, label: 'SLO' }],
      },
      palette
    )
    const [first, second, labels] = option.series as Series[]
    expect(first.markArea).toMatchObject({
      data: [
        [
          {
            xAxis: '2026-08-21T00:00:00.000Z',
            itemStyle: { color: 'red' },
            label: { show: false },
          },
          { xAxis: '2026-09-07T00:00:00.000Z' },
        ],
      ],
    })
    expect(first.markLine).toMatchObject({
      z: 1,
      data: [
        { xAxis: '2026-09-10T14:00:00.000Z', lineStyle: { color: 'blue', opacity: 1 } },
        { yAxis: 50, lineStyle: { color: 'grey', opacity: 1 }, label: { show: false } },
      ],
    })
    expect(second).toEqual({ type: 'line' })
    expect(labels).toMatchObject({
      id: CHART_ANNOTATION_SERIES_ID,
      data: [],
      z: 3,
      markArea: {
        data: [
          [{ name: 'Outage', itemStyle: { opacity: 0 }, label: { show: true, color: 'red' } }, {}],
        ],
      },
      markLine: {
        data: [{ yAxis: 50, name: 'SLO', lineStyle: { opacity: 0 }, label: { color: 'grey' } }],
      },
    })
  })

  it('labels vertical lines at the visual top of an inverted bar axis', () => {
    const option = applyChartAnnotations(
      {
        xAxis: { type: 'value' },
        yAxis: { type: 'category', inverse: true },
        series: [{ type: 'bar' }],
      },
      { thresholds: [{ value: 100, label: 'Needs tuning' }] },
      palette
    )
    const [, labels] = option.series as Series[]
    expect(labels.markLine).toMatchObject({
      data: [{ xAxis: 100, label: { position: 'start' } }],
    })
  })

  it('puts the label series on the same axes as the first series', () => {
    const option = applyChartAnnotations(
      {
        xAxis: { type: 'time' },
        yAxis: [{ type: 'value' }, { type: 'value' }],
        series: [{ type: 'line', yAxisIndex: 1 }],
      },
      { thresholds: [{ value: 5, label: 'Limit' }] },
      palette
    )
    expect((option.series as Series[])[1]).toMatchObject({ yAxisIndex: 1 })
  })

  it('rejects thresholds on a chart without axes', () => {
    expect(() =>
      applyChartAnnotations({ series: [{ type: 'pie' }] }, { thresholds: [{ value: 1 }] }, palette)
    ).toThrow('Thresholds require a value axis')
  })

  it('adds no label series when nothing is labelled', () => {
    const option = applyChartAnnotations(timeSeries, { thresholds: [{ value: 1 }] }, palette)
    expect(option.series).toHaveLength(2)
  })

  it('leaves an option without annotations untouched', () => {
    expect(applyChartAnnotations(timeSeries, {}, palette)).toBe(timeSeries)
  })

  it('refuses to merge with hand-written mark components', () => {
    expect(() =>
      applyChartAnnotations(
        { ...timeSeries, series: [{ type: 'line', markLine: { data: [] } }] },
        { thresholds: [{ value: 1 }] },
        palette
      )
    ).toThrow('Use highlights and thresholds instead of markArea or markLine on the series')
  })

  it('measures thresholds on the axes the first series is plotted on', () => {
    const option = applyChartAnnotations(
      {
        xAxis: { type: 'time' },
        yAxis: [{ type: 'category' }, { id: 'latency', type: 'value' }],
        series: [{ type: 'line', yAxisIndex: 1 }],
      },
      { thresholds: [{ value: 5 }] },
      palette
    )
    expect((option.series as Series[])[0].markLine).toMatchObject({ data: [{ yAxis: 5 }] })
    expect(() =>
      applyChartAnnotations(
        {
          xAxis: { type: 'time' },
          yAxis: [{ type: 'value' }, { id: 'stage', type: 'category' }],
          series: [{ type: 'line', yAxisId: 'stage' }],
        },
        { thresholds: [{ value: 5 }] },
        palette
      )
    ).toThrow('Thresholds require a value axis')
  })

  it('resolves a value axis selected by id, including a value x-axis on horizontal bars', () => {
    const byId = applyChartAnnotations(
      {
        xAxis: { type: 'time' },
        yAxis: [{ type: 'category' }, { id: 'latency', type: 'value' }],
        series: [{ type: 'line', yAxisId: 'latency' }],
      },
      { thresholds: [{ value: 5 }] },
      palette
    )
    expect((byId.series as Series[])[0].markLine).toMatchObject({ data: [{ yAxis: 5 }] })
    const horizontal = applyChartAnnotations(
      {
        xAxis: [{ type: 'category' }, { id: 'count', type: 'value' }],
        yAxis: [{ type: 'value' }, { id: 'stage', type: 'category', inverse: true }],
        series: [{ type: 'bar', xAxisId: 'count', yAxisIndex: 1 }],
      },
      { thresholds: [{ value: 5, label: 'Limit' }] },
      palette
    )
    const [first, labels] = horizontal.series as Series[]
    expect(first.markLine).toMatchObject({ data: [{ xAxis: 5 }] })
    expect(labels.markLine).toMatchObject({ data: [{ xAxis: 5, label: { position: 'start' } }] })
  })

  it('prefers the axis index over the axis id, as ECharts does', () => {
    const option = applyChartAnnotations(
      {
        xAxis: { type: 'time' },
        yAxis: [
          { id: 'stage', type: 'category' },
          { id: 7, type: 'value' },
        ],
        series: [{ type: 'line', yAxisIndex: 1, yAxisId: 'stage' }],
      },
      { thresholds: [{ value: 5 }] },
      palette
    )
    expect((option.series as Series[])[0].markLine).toMatchObject({ data: [{ yAxis: 5 }] })
    expect(() =>
      applyChartAnnotations(
        { ...option, series: [{ type: 'line', yAxisId: '7' }] },
        { thresholds: [{ value: 5 }] },
        palette
      )
    ).not.toThrow()
  })

  it('rejects a first series that references an axis the chart does not define', () => {
    for (const reference of [{ yAxisIndex: 1 }, { yAxisIndex: -1 }, { yAxisIndex: 0.5 }])
      expect(() =>
        applyChartAnnotations(
          {
            xAxis: { type: 'time' },
            yAxis: { type: 'value' },
            series: [{ type: 'line', ...reference }],
          },
          { thresholds: [{ value: 5 }] },
          palette
        )
      ).toThrow('The first series references a missing yAxis')
    expect(() =>
      applyChartAnnotations(
        { xAxis: { type: 'time' }, yAxis: [], series: [{ type: 'line' }] },
        { thresholds: [{ value: 5 }] },
        palette
      )
    ).toThrow('The first series references a missing yAxis')
  })
})
