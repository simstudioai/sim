/** @vitest-environment jsdom */
import * as echarts from 'echarts'
import { describe, expect, it } from 'vitest'
import { applyChartTooltipDefaults } from '@/lib/charts/theme'

/** Distinct font metrics make a lost font visible in both layout and rendered text. */
echarts.setPlatformAPI({
  measureText: (text, font) => ({
    width: String(text).length * (font?.includes('Season Sans') ? 8 : 6),
  }),
})

describe('ECharts rich-text tooltip font patch', () => {
  it('renders the encoded pie count and percent from a table dataset', () => {
    const chart = echarts.init(
      document.createElement('div'),
      {},
      {
        renderer: 'svg',
        width: 600,
        height: 300,
      }
    )
    try {
      chart.setOption(
        applyChartTooltipDefaults({
          animation: false,
          dataset: {
            source: [
              { outcome: 'AI resolved', tickets: 75 },
              { outcome: 'Human resolved', tickets: 25 },
            ],
          },
          tooltip: { renderMode: 'richText' },
          series: [{ type: 'pie', encode: { itemName: 'outcome', value: 'tickets' } }],
        })
      )
      chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: 1 })
      expect(
        chart
          .getZr()
          .storage.getDisplayList(true)
          .map((element) => element.style.text)
          .filter((text) => typeof text === 'string')
      ).toEqual(expect.arrayContaining(['Human resolved: 25 (25%)']))
    } finally {
      chart.dispose()
    }
  })

  it.each([
    { fontFamily: 'Season Sans', fontSize: 12, fontWeight: 'normal' as const },
    { fontFamily: 'Georgia', fontSize: 18, fontWeight: 'bold' as const },
  ])('measures and renders a formatter with $fontFamily', (textStyle) => {
    const chart = echarts.init(
      document.createElement('div'),
      {},
      {
        renderer: 'svg',
        width: 600,
        height: 300,
      }
    )
    try {
      chart.setOption({
        animation: false,
        tooltip: {
          renderMode: 'richText',
          formatter: 'Native canary failure: 11',
          padding: [6, 12],
          backgroundColor: '#ffffff',
          textStyle: { ...textStyle, lineHeight: 18 },
        },
        xAxis: { type: 'value' },
        yAxis: { type: 'category', data: ['Native canary failure'] },
        series: [{ type: 'bar', data: [11] }],
      })
      chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: 0 })
      const elements = chart.getZr().storage.getDisplayList(true)
      const text = elements.find((element) => element.style.text === 'Native canary failure: 11')
      const box = elements.find(
        (element) => element.type === 'rect' && element.style.fill === '#ffffff'
      )
      expect(text?.style.font).toContain(textStyle.fontFamily)
      expect(text?.style.font).toContain(`${textStyle.fontSize}px`)
      expect(text?.style.font).toContain(textStyle.fontWeight)
      expect(box).toBeDefined()
      /** Padding plus the one-pixel border drawn outside each side. */
      expect(box!.getBoundingRect().width).toBeCloseTo(text!.getBoundingRect().width + 26)
      expect(box!.getBoundingRect().height).toBe(32)
    } finally {
      chart.dispose()
    }
  })

  it('applies the configured family to built-in tooltip names and values', () => {
    const chart = echarts.init(
      document.createElement('div'),
      {},
      {
        renderer: 'svg',
        width: 600,
        height: 300,
      }
    )
    try {
      chart.setOption({
        animation: false,
        tooltip: {
          renderMode: 'richText',
          textStyle: { fontFamily: 'Season Sans', fontSize: 12, fontWeight: 'normal' },
        },
        series: [{ type: 'pie', data: [{ name: 'Reports', value: 11 }] }],
      })
      chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: 0 })
      const tooltipText = chart
        .getZr()
        .storage.getDisplayList(true)
        .filter((element) => element.z === 60 && ['Reports', '11'].includes(element.style.text))
      expect(tooltipText).toHaveLength(2)
      for (const text of tooltipText) expect(text.style.font).toContain('Season Sans')
    } finally {
      chart.dispose()
    }
  })
})
