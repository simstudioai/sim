/** @vitest-environment node */
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

  it('keeps native formatting for pies with automatic encodings', () => {
    expect(
      applyChartTooltipDefaults({
        series: [{ type: 'pie', data: [{ name: 'Reports', value: 11 }] }],
      })
    ).not.toHaveProperty('tooltip')
  })
})
