import { toRecord } from '@sim/utils/object'
import type { EChartsType } from 'echarts'
import {
  ABOVE_BAR_LABEL_SPACE,
  horizontalBarWidth,
  isAboveBarLabelLayout,
} from '@/lib/charts/option'

const HIGHLIGHT_ID = 'sim-bar-row-highlight'
/** Space kept below the bar inside the highlight; the rest of the row sits above it. */
const BELOW_BAR_MARGIN = 2

/**
 * ECharts centres its shadow pointer on the bar, so with labels above the bars it cuts through
 * the label and spills into the next row. This draws one row highlight around label and bar.
 */
export function installBarRowHighlight(
  chart: EChartsType,
  option: Record<string, unknown>
): () => void {
  if (!isAboveBarLabelLayout(option)) return () => {}
  const barWidth = horizontalBarWidth(option)
  const rowHeight = barWidth + ABOVE_BAR_LABEL_SPACE
  const grid = toRecord(Array.isArray(option.grid) ? option.grid[0] : option.grid)
  const inset = (value: unknown) => {
    if (typeof value === 'number') return value
    if (typeof value === 'string' && value.endsWith('%'))
      return (chart.getWidth() * Number.parseFloat(value)) / 100
    return typeof value === 'string' && Number.isFinite(Number(value)) ? Number(value) : 0
  }
  const color = getComputedStyle(chart.getDom()).getPropertyValue('--text-body').trim()
  let current: number | null = null

  const render = (row: number | null) => {
    if (row === current) return
    current = row
    if (row === null) {
      chart.setOption({ graphic: [{ id: HIGHLIGHT_ID, type: 'rect', invisible: true }] })
      return
    }
    const center = chart.convertToPixel({ yAxisIndex: 0 }, row)
    const left = inset(grid.left)
    const bottom = center + barWidth / 2 + BELOW_BAR_MARGIN
    chart.setOption({
      graphic: [
        {
          id: HIGHLIGHT_ID,
          type: 'rect',
          invisible: false,
          silent: true,
          z: 0,
          shape: {
            x: left,
            y: bottom - rowHeight,
            width: chart.getWidth() - left - inset(grid.right),
            height: rowHeight,
          },
          style: { fill: color, opacity: 0.06 },
        },
      ],
    })
  }
  const onPointer = (event: unknown) => {
    const axes = toRecord(event).axesInfo
    const category = Array.isArray(axes)
      ? axes.map(toRecord).find((axis) => axis.axisDim === 'y')
      : undefined
    render(typeof category?.value === 'number' ? category.value : null)
  }
  const onLeave = () => render(null)
  chart.on('updateAxisPointer', onPointer)
  chart.on('globalout', onLeave)
  return () => {
    chart.off('updateAxisPointer', onPointer)
    chart.off('globalout', onLeave)
  }
}
