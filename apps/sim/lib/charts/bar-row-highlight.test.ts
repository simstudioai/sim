/** @vitest-environment jsdom */

import { init } from 'echarts'
import { expect, it } from 'vitest'
import { installBarRowHighlight } from '@/lib/charts/bar-row-highlight'
import { buildChartRenderOption, horizontalBarChartHeight } from '@/lib/charts/option'
import { applyChartTooltipDefaults } from '@/lib/charts/theme'

it('highlights the hovered row around its label and bar without touching neighbouring rows', () => {
  const categories = Array.from({ length: 10 }, (_, index) => `sim-alarm-${index}`)
  const spec = {
    animation: false,
    xAxis: { type: 'value' },
    yAxis: { type: 'category', inverse: true, data: categories },
    series: [{ type: 'bar', data: categories.map((_, index) => 100 - index * 9) }],
  }
  const option = applyChartTooltipDefaults(buildChartRenderOption({ option: spec }))
  const height = horizontalBarChartHeight(spec, categories.length) ?? 0
  const element = document.createElement('div')
  element.style.setProperty('--text-body', '#111111')
  document.body.append(element)
  const chart = init(element, undefined, { renderer: 'svg', width: 720, height })
  try {
    chart.setOption(option)
    const dispose = installBarRowHighlight(chart, option)
    const hovered = 4
    chart.dispatchAction({ type: 'showTip', seriesIndex: 0, dataIndex: hovered })
    const elements = chart.getZr().storage.getDisplayList(true)
    const labelTop = (text: string) => {
      const label = elements.find((node) => node.type === 'tspan' && node.style.text === text)
      if (!label) throw new Error(`Missing label ${text}`)
      const rect = label.getBoundingRect().clone()
      if (label.transform) rect.applyTransform(label.transform)
      return rect.y
    }
    const highlight = elements.find(
      (node) => node.type === 'rect' && !node.invisible && node.style.opacity === 0.06
    )
    if (!highlight) throw new Error('Missing row highlight')
    const area = highlight.getBoundingRect()
    const barCenter = (row: number) => chart.convertToPixel({ yAxisIndex: 0 }, row)
    expect(area.y).toBeLessThanOrEqual(labelTop(categories[hovered]))
    expect(area.y + area.height).toBeGreaterThanOrEqual(barCenter(hovered) + 8)
    expect(area.y).toBeGreaterThanOrEqual(barCenter(hovered - 1) + 8)
    expect(area.y + area.height).toBeLessThanOrEqual(labelTop(categories[hovered + 1]))

    chart.resize({ width: 720, height: height * 2 })
    chart.getZr().flush()
    chart.getZr().flush()
    const resized = chart
      .getZr()
      .storage.getDisplayList(true)
      .find((node) => node.type === 'rect' && !node.invisible && node.style.opacity === 0.06)
    if (!resized) throw new Error('Missing row highlight after resize')
    const moved = resized.getBoundingRect()
    expect(moved.y + moved.height).toBeGreaterThanOrEqual(barCenter(hovered) + 8)
    expect(moved.y).toBeGreaterThanOrEqual(barCenter(hovered - 1) + 8)
    dispose()
  } finally {
    chart.dispose()
    element.remove()
  }
})
