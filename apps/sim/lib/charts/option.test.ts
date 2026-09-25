/** @vitest-environment node */

import { init } from 'echarts'
import { describe, expect, it } from 'vitest'
import { buildChartRenderOption } from '@/lib/charts/option'

describe('chart dataset injection', () => {
  it('injects empty results, ahead of authored datasets, without mutation', () => {
    const authored = { dataset: { source: [{ count: 999 }] } }
    expect(buildChartRenderOption({ option: authored, rows: [] }).dataset).toEqual([
      { id: 'table', source: [] },
      authored.dataset,
    ])
    expect(authored).toEqual({ dataset: { source: [{ count: 999 }] } })
  })
  it('preserves static options without query data', () => {
    expect(buildChartRenderOption({ option: { dataset: { source: [1, 2] } } }).dataset).toEqual({
      source: [1, 2],
    })
  })
})

describe('horizontal bar label layout', () => {
  it('moves category labels above the plot rows without mutating authored options', () => {
    const authored = {
      xAxis: { type: 'value' },
      yAxis: [{ type: 'category', inverse: true }],
      series: [{ type: 'bar', encode: { x: 'count', y: 'category' } }],
    }
    const result = buildChartRenderOption({ option: authored })
    expect(result.yAxis).toEqual([
      expect.objectContaining({
        inverse: true,
        axisLabel: expect.objectContaining({
          inside: true,
          align: 'left',
          verticalAlign: 'bottom',
        }),
      }),
    ])
    expect(authored.yAxis[0]).not.toHaveProperty('axisLabel')
  })

  it('preserves authored category label placement and leaves vertical bars alone', () => {
    const axisLabel = { inside: false, align: 'right', margin: 12, padding: 0 }
    const result = buildChartRenderOption({
      option: {
        xAxis: { type: 'value' },
        yAxis: { type: 'category', axisLabel },
        series: [{ type: 'bar' }],
      },
    })
    expect(result.yAxis).toMatchObject({ axisLabel })
    const vertical = {
      xAxis: { type: 'category' },
      yAxis: { type: 'value' },
      series: [{ type: 'bar' }],
    }
    expect(buildChartRenderOption({ option: vertical }).yAxis).toEqual(vertical.yAxis)
  })
})

describe('rendered chart bounds', () => {
  it('keeps percentage end ticks inside the canvas and labels clear of thick bars', () => {
    const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 360, height: 240 })
    const categories = ['Local delivery cooperative', 'Northstar Express', 'Parcelway']
    try {
      chart.setOption(
        buildChartRenderOption({
          option: {
            animation: false,
            xAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}%' } },
            yAxis: { type: 'category', inverse: true, data: categories },
            series: [{ type: 'bar', barWidth: 28, data: [84, 96, 81] }],
          },
        })
      )
      const labels = chart
        .getZr()
        .storage.getDisplayList(true)
        .filter((element) => element.type === 'tspan')
        .map((element) => {
          const bounds = element.getBoundingRect().clone()
          if (element.transform) bounds.applyTransform(element.transform)
          return { text: element.style.text, bounds }
        })
      expect(labels.some((label) => label.text === '100%')).toBe(true)
      for (const { text, bounds } of labels) {
        expect(bounds.x, String(text)).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width, String(text)).toBeLessThanOrEqual(360)
        expect(bounds.y, String(text)).toBeGreaterThanOrEqual(0)
        expect(bounds.y + bounds.height, String(text)).toBeLessThanOrEqual(240)
        const categoryIndex = categories.indexOf(String(text))
        if (categoryIndex === -1) continue
        const center = chart.convertToPixel({ seriesIndex: 0 }, [0, categoryIndex])
        if (!Array.isArray(center)) throw new Error('Expected a Cartesian coordinate')
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(center[1] - 14 - 6)
      }
    } finally {
      chart.dispose()
    }
  })

  it('fits axis names below a legend even when the authored grid starts near the top', () => {
    const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 320, height: 240 })
    try {
      chart.setOption(
        buildChartRenderOption({
          option: {
            animation: false,
            legend: {},
            grid: { left: 58, right: 20, top: 24, bottom: 58 },
            xAxis: { type: 'category', data: ['Direct', 'Partners'] },
            yAxis: { type: 'value', name: 'USD' },
            series: [{ name: 'Net sales', type: 'bar', data: [14000, 16000] }],
          },
        })
      )
      const name = chart
        .getZr()
        .storage.getDisplayList(true)
        .find((element) => element.type === 'tspan' && element.style.text === 'USD')
      expect(name).toBeDefined()
      if (!name) throw new Error('Missing axis name')
      const bounds = name.getBoundingRect().clone()
      if (name.transform) bounds.applyTransform(name.transform)
      expect(bounds.y).toBeGreaterThanOrEqual(48)
      expect(bounds.x).toBeGreaterThanOrEqual(0)
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(320)
    } finally {
      chart.dispose()
    }
  })
})
