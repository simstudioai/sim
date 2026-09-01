/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const modules = {
    barChart: Symbol('BarChart'),
    candlestickChart: Symbol('CandlestickChart'),
    customChart: Symbol('CustomChart'),
    lineChart: Symbol('LineChart'),
    pieChart: Symbol('PieChart'),
    radarChart: Symbol('RadarChart'),
    scatterChart: Symbol('ScatterChart'),
    axisPointerComponent: Symbol('AxisPointerComponent'),
    gridComponent: Symbol('GridComponent'),
    legendComponent: Symbol('LegendComponent'),
    radarComponent: Symbol('RadarComponent'),
    titleComponent: Symbol('TitleComponent'),
    tooltipComponent: Symbol('TooltipComponent'),
    labelLayout: Symbol('LabelLayout'),
    legacyGridContainLabel: Symbol('LegacyGridContainLabel'),
    canvasRenderer: Symbol('CanvasRenderer'),
  }

  return {
    format: { encodeHTML: vi.fn() },
    graphic: { LinearGradient: vi.fn() },
    init: vi.fn(),
    modules,
    use: vi.fn(),
  }
})

vi.mock('echarts/charts', () => ({
  BarChart: mocks.modules.barChart,
  CandlestickChart: mocks.modules.candlestickChart,
  CustomChart: mocks.modules.customChart,
  LineChart: mocks.modules.lineChart,
  PieChart: mocks.modules.pieChart,
  RadarChart: mocks.modules.radarChart,
  ScatterChart: mocks.modules.scatterChart,
}))

vi.mock('echarts/components', () => ({
  AxisPointerComponent: mocks.modules.axisPointerComponent,
  GridComponent: mocks.modules.gridComponent,
  LegendComponent: mocks.modules.legendComponent,
  RadarComponent: mocks.modules.radarComponent,
  TitleComponent: mocks.modules.titleComponent,
  TooltipComponent: mocks.modules.tooltipComponent,
}))

vi.mock('echarts/core', () => ({
  format: mocks.format,
  graphic: mocks.graphic,
  init: mocks.init,
  use: mocks.use,
}))

vi.mock('echarts/features', () => ({
  LabelLayout: mocks.modules.labelLayout,
  LegacyGridContainLabel: mocks.modules.legacyGridContainLabel,
}))

vi.mock('echarts/renderers', () => ({
  CanvasRenderer: mocks.modules.canvasRenderer,
}))

import { format, graphic, init } from '@/lib/pptx-renderer/renderer/echarts-runtime'

describe('PPTX ECharts runtime', () => {
  it('registers only the chart modules used by PPTX rendering', () => {
    expect(mocks.use).toHaveBeenCalledOnce()
    expect(mocks.use).toHaveBeenCalledWith([
      mocks.modules.barChart,
      mocks.modules.candlestickChart,
      mocks.modules.customChart,
      mocks.modules.lineChart,
      mocks.modules.pieChart,
      mocks.modules.radarChart,
      mocks.modules.scatterChart,
      mocks.modules.axisPointerComponent,
      mocks.modules.gridComponent,
      mocks.modules.legendComponent,
      mocks.modules.radarComponent,
      mocks.modules.titleComponent,
      mocks.modules.tooltipComponent,
      mocks.modules.labelLayout,
      mocks.modules.legacyGridContainLabel,
      mocks.modules.canvasRenderer,
    ])
  })

  it('exposes the core helpers consumed by the chart renderer', () => {
    expect(format).toBe(mocks.format)
    expect(graphic).toBe(mocks.graphic)
    expect(init).toBe(mocks.init)
  })
})
