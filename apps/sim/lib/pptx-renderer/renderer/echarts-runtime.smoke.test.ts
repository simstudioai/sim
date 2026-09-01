/**
 * @vitest-environment node
 */
import { use } from 'echarts/core'
import { SVGRenderer } from 'echarts/renderers'
import { describe, expect, it } from 'vitest'
import { init } from '@/lib/pptx-renderer/renderer/echarts-runtime'

use([SVGRenderer])

describe('PPTX ECharts runtime smoke', () => {
  it('renders representative registered charts and components', () => {
    const chart = init(null, null, {
      renderer: 'svg',
      ssr: true,
      width: 400,
      height: 300,
    })

    try {
      chart.setOption({
        title: { text: 'Quarterly results' },
        tooltip: {},
        legend: {},
        xAxis: { type: 'category', data: ['Q1', 'Q2'] },
        yAxis: { type: 'value' },
        series: [
          { name: 'Revenue', type: 'bar', data: [12, 18] },
          { name: 'Target', type: 'line', data: [10, 16] },
        ],
      })

      const svg = chart.renderToSVGString()
      expect(svg).toContain('<svg')
      expect(svg).toContain('Quarterly results')
      expect(chart.getModel().getSeriesCount()).toBe(2)
    } finally {
      chart.dispose()
    }
  })
})
