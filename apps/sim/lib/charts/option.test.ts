import { init } from 'echarts'
import { describe, expect, it } from 'vitest'
import {
  buildChartRenderOption,
  CHART_BAR_MAX_WIDTH,
  horizontalBarChartHeight,
  isAboveBarLabelLayout,
} from '@/lib/charts/option'

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

  it('reserves the authored gap between grouped bars in each row', () => {
    const grouped = (barGap?: string | number) => ({
      xAxis: { type: 'value' },
      yAxis: { type: 'category' },
      series: [
        { type: 'bar', barWidth: 20, ...(barGap === undefined ? {} : { barGap }) },
        { type: 'bar', barWidth: 20 },
      ],
    })
    const rows = 10
    const base = horizontalBarChartHeight(grouped('0%'), rows) ?? 0
    expect(horizontalBarChartHeight(grouped(), rows)).toBe(base + rows * 4)
    expect(horizontalBarChartHeight(grouped('150%'), rows)).toBe(base + rows * 30)
    expect(horizontalBarChartHeight(grouped(40), rows)).toBe(base + rows * 40)
    expect(horizontalBarChartHeight(grouped('-100%'), rows)).toBe(base - rows * 20)
  })

  it('keeps every authored tooltip entry when turning off the shadow pointer', () => {
    const result = buildChartRenderOption({
      option: {
        tooltip: [{ show: true, confine: true }],
        xAxis: { type: 'value' },
        yAxis: { type: 'category' },
        series: [{ type: 'bar' }],
      },
    })
    expect(result.tooltip).toEqual([{ show: true, confine: true, axisPointer: { type: 'none' } }])
    expect(isAboveBarLabelLayout(result)).toBe(true)
  })

  it('keeps the label column for grouped bars and sizes rows for every bar in the group', () => {
    const grouped = {
      xAxis: { type: 'value' },
      yAxis: { type: 'category' },
      series: [{ type: 'bar' }, { type: 'bar' }],
    }
    expect(buildChartRenderOption({ option: grouped }).yAxis).not.toHaveProperty('axisLabel')
    const single = { ...grouped, series: [{ type: 'bar' }] }
    const rows = 20
    expect(horizontalBarChartHeight(grouped, rows)).toBeGreaterThanOrEqual(
      (horizontalBarChartHeight({ ...single, grid: { left: 0 } }, rows) ?? 0) +
        rows * CHART_BAR_MAX_WIDTH
    )
    const stacked = {
      ...grouped,
      series: [
        { type: 'bar', stack: 'total' },
        { type: 'bar', stack: 'total' },
      ],
    }
    expect(buildChartRenderOption({ option: stacked }).yAxis).toMatchObject({
      axisLabel: { inside: true },
    })
  })

  it('keeps the ECharts label column for percentage bar widths it cannot size per row', () => {
    const option = {
      xAxis: { type: 'value' },
      yAxis: { type: 'category' },
      series: [{ type: 'bar', barWidth: '60%' }],
    }
    const result = buildChartRenderOption({ option })
    expect(result.yAxis).not.toHaveProperty('axisLabel')
    expect(horizontalBarChartHeight(option, 10)).toBe(
      horizontalBarChartHeight({ ...option, grid: { left: 0 } }, 10)
    )
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

  it('sizes horizontal bars so every above-bar label clears the neighbouring bars', () => {
    const categories = Array.from(
      { length: 10 },
      (_, index) => `sim-production-us-east-1-alarm-number-${index}`
    )
    const option = {
      animation: false,
      xAxis: { type: 'value', name: 'Investigations' },
      yAxis: { type: 'category', inverse: true, data: categories },
      series: [{ type: 'bar', data: categories.map((_, index) => 100 - index * 9) }],
    }
    const height = horizontalBarChartHeight(option, categories.length)
    const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 720, height })
    try {
      chart.setOption(buildChartRenderOption({ option }))
      const labels = chart
        .getZr()
        .storage.getDisplayList(true)
        .filter((element) => element.type === 'tspan')
        .map((element) => {
          const bounds = element.getBoundingRect().clone()
          if (element.transform) bounds.applyTransform(element.transform)
          return { text: String(element.style.text), bounds }
        })
      categories.forEach((category, index) => {
        const label = labels.find(({ text }) => text === category)
        if (!label) throw new Error(`Missing label for ${category}`)
        const center = chart.convertToPixel({ seriesIndex: 0 }, [0, index])
        if (!Array.isArray(center)) throw new Error('Expected a Cartesian coordinate')
        expect(label.bounds.y + label.bounds.height, category).toBeLessThanOrEqual(
          center[1] - CHART_BAR_MAX_WIDTH / 2
        )
        if (index === 0) return
        const previous = chart.convertToPixel({ seriesIndex: 0 }, [0, index - 1])
        if (!Array.isArray(previous)) throw new Error('Expected a Cartesian coordinate')
        expect(label.bounds.y, category).toBeGreaterThanOrEqual(
          previous[1] + CHART_BAR_MAX_WIDTH / 2
        )
      })
      expect(horizontalBarChartHeight({ xAxis: { type: 'category' } }, 10)).toBeNull()
    } finally {
      chart.dispose()
    }
  })

  it('keeps an authored left label column intact instead of blending it with inside labels', () => {
    const chart = init(null, undefined, { renderer: 'svg', ssr: true, width: 720, height: 360 })
    const rows = [
      { alarm: 'sim-staging-us-east-1-integ-failure', investigations: 120 },
      { alarm: 'sim-production-us-east-1-copilot-5xx-rate', investigations: 64 },
      { alarm: 'trigger-dev-queue-depth', investigations: 9 },
    ]
    try {
      chart.setOption(
        buildChartRenderOption({
          rows,
          option: {
            animation: false,
            grid: { containLabel: true, left: 12, right: 45, top: 15, bottom: 25 },
            xAxis: { type: 'value', name: 'Investigations', min: 0, minInterval: 1 },
            yAxis: {
              type: 'category',
              inverse: true,
              axisLabel: { width: 320, overflow: 'truncate', fontSize: 11 },
            },
            series: [
              {
                type: 'bar',
                label: { show: true, position: 'right' },
                encode: { x: 'investigations', y: 'alarm' },
              },
            ],
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
          return { text: String(element.style.text), bounds }
        })
      rows.forEach(({ alarm }, index) => {
        const label = labels.find(({ text }) => alarm.startsWith(text.replace(/…$/, '')))
        if (!label) throw new Error(`Missing label for ${alarm}`)
        const origin = chart.convertToPixel({ seriesIndex: 0 }, [0, index])
        if (!Array.isArray(origin)) throw new Error('Expected a Cartesian coordinate')
        expect(label.bounds.x, alarm).toBeGreaterThanOrEqual(0)
        expect(label.bounds.y, alarm).toBeGreaterThanOrEqual(0)
        expect(label.bounds.x + label.bounds.width, alarm).toBeLessThanOrEqual(origin[0])
      })
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
