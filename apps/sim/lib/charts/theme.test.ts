import { toRecord } from '@sim/utils/object'
import { describe, expect, it } from 'vitest'
import { applyChartTooltipDefaults, formatBarTooltip, formatPieTooltip } from '@/lib/charts/theme'

describe('compact bar tooltips', () => {
  it('uses the value encoding, including numeric categories and missing values', () => {
    const entry = {
      axisValueLabel: '2026',
      seriesName: 'series\u00000',
      encode: { x: [1], y: [0] },
      dimensionNames: ['year', 'reports'],
      value: { year: 2026, reports: 10 },
    }
    expect(formatBarTooltip(entry, 'x')).toBe('2026: 10')
    expect(formatBarTooltip({ ...entry, value: { year: 2026, reports: null } }, 'x')).toBe(
      '2026: —'
    )
  })
  it('formats each series with its own value axis', () => {
    const option = applyChartTooltipDefaults({
      xAxis: { type: 'category' },
      yAxis: [{ type: 'value', axisLabel: { formatter: '{value}%' } }, { type: 'value' }],
      series: [
        { type: 'bar', name: 'Rate' },
        { type: 'bar', name: 'Count', yAxisIndex: 1 },
      ],
    })
    const formatter = toRecord(option.tooltip).formatter
    if (typeof formatter !== 'function') throw new Error('Expected the bar tooltip formatter')
    expect(
      formatter([
        { seriesIndex: 0, seriesName: 'Rate', axisValueLabel: 'Mon', value: 75 },
        { seriesIndex: 1, seriesName: 'Count', axisValueLabel: 'Mon', value: 75 },
      ])
    ).toBe('Mon · Rate: 75%\nMon · Count: 75')
  })
  it('uses a floating tooltip with row hover and preserves authored overrides', () => {
    expect(applyChartTooltipDefaults({ series: [{ type: 'bar' }] }).tooltip).toMatchObject({
      trigger: 'axis',
      showContent: true,
      axisPointer: { type: 'shadow' },
    })
    const tooltip = {
      trigger: 'item',
      showContent: false,
      axisPointer: { type: 'line' },
      formatter: '{b}: {c}',
      padding: 12,
    }
    expect(applyChartTooltipDefaults({ series: [{ type: 'bar' }], tooltip }).tooltip).toEqual(
      tooltip
    )
    expect(applyChartTooltipDefaults({ series: [{ type: 'line' }] })).not.toHaveProperty('tooltip')
  })
  it('formats a dataset-backed horizontal percentage with the value axis units', () => {
    const option = applyChartTooltipDefaults({
      xAxis: { type: 'value', axisLabel: { formatter: '{value}%' } },
      yAxis: { type: 'category' },
      series: [{ type: 'bar' }],
    })
    const tooltip = option.tooltip as { formatter: (params: unknown) => string }
    expect(
      tooltip.formatter({
        name: 'Carrier',
        value: { carrier: 'Carrier', rate: 87.25 },
        dimensionNames: ['carrier', 'rate'],
        encode: { x: [1], y: [0] },
      })
    ).toBe('Carrier: 87.25%')
  })
})

describe('pie tooltips', () => {
  it.each([{ topic: 'Human resolved', tickets: 437 }, ['Human resolved', 437], 437])(
    'reads the measure from object rows, array rows and scalar data',
    (value) => {
      expect(
        formatPieTooltip({
          name: 'Human resolved',
          value,
          dimensionNames: ['topic', 'tickets'],
          encode: { value: [1] },
          percent: 25.23,
        })
      ).toBe('Human resolved: 437 (25.23%)')
    }
  )

  it('preserves an explicit pie formatter', () => {
    expect(
      applyChartTooltipDefaults({
        series: [{ type: 'pie', encode: { itemName: 'topic', value: 'tickets' } }],
        tooltip: { formatter: '{b}: {d}%' },
      }).tooltip
    ).toMatchObject({ formatter: '{b}: {d}%' })
  })

  it('formats pies encoded by dimension index with the encoded measure', () => {
    const option = applyChartTooltipDefaults({
      series: [{ type: 'pie', encode: { itemName: 0, value: 1 } }],
    })
    const formatter = toRecord(option.tooltip).formatter
    if (typeof formatter !== 'function') throw new Error('Expected the pie tooltip formatter')
    expect(
      formatter({
        seriesIndex: 0,
        name: 'Human resolved',
        value: ['Human resolved', 437],
        dimensionNames: ['topic', 'tickets'],
        encode: { value: [1] },
        percent: 25,
      })
    ).toBe('Human resolved: 437 (25%)')
  })

  it('keeps native formatting for pies with automatic encodings', () => {
    expect(
      applyChartTooltipDefaults({
        series: [{ type: 'pie', data: [{ name: 'Reports', value: 11 }] }],
      })
    ).not.toHaveProperty('tooltip')
  })
})
