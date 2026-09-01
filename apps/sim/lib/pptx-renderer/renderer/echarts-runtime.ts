import {
  BarChart,
  CandlestickChart,
  CustomChart,
  LineChart,
  PieChart,
  RadarChart,
  ScatterChart,
} from 'echarts/charts'
import {
  AxisPointerComponent,
  GridComponent,
  LegendComponent,
  RadarComponent,
  TitleComponent,
  TooltipComponent,
} from 'echarts/components'
import { format, graphic, init, use } from 'echarts/core'
import { LabelLayout, LegacyGridContainLabel } from 'echarts/features'
import { CanvasRenderer } from 'echarts/renderers'

use([
  BarChart,
  CandlestickChart,
  CustomChart,
  LineChart,
  PieChart,
  RadarChart,
  ScatterChart,
  AxisPointerComponent,
  GridComponent,
  LegendComponent,
  RadarComponent,
  TitleComponent,
  TooltipComponent,
  LabelLayout,
  LegacyGridContainLabel,
  CanvasRenderer,
])

export { format, graphic, init }
