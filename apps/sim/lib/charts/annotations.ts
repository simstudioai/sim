import { filterUndefined, toRecord } from '@sim/utils/object'

export const CHART_TONES = ['neutral', 'error', 'info'] as const
export type ChartTone = (typeof CHART_TONES)[number]
/** Tone colours for bands, lines, and their labels; neutral matches the axis labels. */
export interface ChartTonePalette {
  tones: Record<ChartTone, string>
}

/** A shaded stretch of time, or a single instant drawn as a vertical line. */
export type ChartHighlight =
  | { from: string; to: string; label?: string; tone?: ChartTone }
  | { at: string; label?: string; tone?: ChartTone }

/** A horizontal (or, on horizontal bars, vertical) reference line on the value axis. */
export interface ChartThreshold {
  value: number
  label?: string
  tone?: ChartTone
}

export interface ChartAnnotations {
  /** Applied only to charts with a time x-axis. */
  highlights?: readonly ChartHighlight[]
  thresholds?: readonly ChartThreshold[]
}

const BAND_OPACITY = 0.08

function firstSeries(option: Record<string, unknown>): Record<string, unknown> {
  return toRecord(Array.isArray(option.series) ? option.series[0] : option.series)
}

/**
 * The axis the first series is plotted on. Like ECharts, `*AxisIndex` wins over `*AxisId`, and ids
 * match across string and number.
 */
function seriesAxis(
  option: Record<string, unknown>,
  key: 'xAxis' | 'yAxis'
): Record<string, unknown> {
  const axes = Array.isArray(option[key]) ? (option[key] as unknown[]) : [option[key]]
  const series = firstSeries(option)
  const id = series[`${key}Id`]
  if (series[`${key}Index`] === undefined && id !== undefined) {
    const axis = axes.find((candidate) => String(toRecord(candidate).id) === String(id))
    if (axis === undefined) throw new Error(`The first series references a missing ${key} "${id}"`)
    return toRecord(axis)
  }
  const index = series[`${key}Index`] ?? 0
  if (option[key] === undefined && index === 0) return {}
  if (!Number.isInteger(index) || axes[index as number] === undefined)
    throw new Error(`The first series references a missing ${key} at index ${String(index)}`)
  return toRecord(axes[index as number])
}

/**
 * The axis a threshold is measured on, among the axes the first series is plotted on; ECharts
 * defaults an unspecified yAxis to a value axis.
 */
export function valueAxisKey(option: Record<string, unknown>): 'xAxis' | 'yAxis' {
  if (option.xAxis === undefined && option.yAxis === undefined)
    throw new Error('Thresholds require a value axis')
  const y = seriesAxis(option, 'yAxis')
  if (y.type === undefined || y.type === 'value' || y.type === 'log') return 'yAxis'
  const x = seriesAxis(option, 'xAxis')
  if (x.type === 'value' || x.type === 'log') return 'xAxis'
  throw new Error('Thresholds require a value axis')
}

/**
 * A vertical line runs from the y-axis start to its end, so its visual top is the start when the
 * y axis is inverted (as horizontal bar charts usually are).
 */
function verticalTop(option: Record<string, unknown>): 'start' | 'end' {
  return seriesAxis(option, 'yAxis').inverse === true ? 'start' : 'end'
}

/** A chart annotations can draw on: a first series with no hand-written marks to collide with. */
export function assertAnnotatable(option: Record<string, unknown>): void {
  const series = Array.isArray(option.series) ? option.series : [option.series]
  if (series[0] === undefined) throw new Error('Highlights and thresholds require a series')
  const first = toRecord(series[0])
  if (first.markArea !== undefined || first.markLine !== undefined)
    throw new Error('Use highlights and thresholds instead of markArea or markLine on the series')
}

/**
 * Id of the empty series that carries annotation labels. ECharts draws a mark's label at the mark's
 * depth, so the marks sit under the data and their labels ride on this series above it.
 */
export const CHART_ANNOTATION_SERIES_ID = '\u0000annotations'

interface AnnotationMark {
  label?: string
  color: string
  position: string
}

/** Vertical lines label upright past their top end; ECharts rotates `inside*` labels. */
function markLabel(mark: AnnotationMark) {
  return { show: true, formatter: '{b}', color: mark.color, fontSize: 12, position: mark.position }
}

/**
 * Draws highlights and thresholds as `markArea` and `markLine` under the first series, with their
 * labels on a silent series drawn above every series, coloured from the theme palette.
 */
export function applyChartAnnotations(
  option: Record<string, unknown>,
  annotations: ChartAnnotations,
  palette: ChartTonePalette
): Record<string, unknown> {
  const highlights = annotations.highlights ?? []
  const thresholds = annotations.thresholds ?? []
  if (highlights.length === 0 && thresholds.length === 0) return option
  assertAnnotatable(option)
  const series = Array.isArray(option.series) ? option.series : [option.series]
  const first = toRecord(series[0])

  const bands: Array<AnnotationMark & { from: string; to: string }> = []
  const lines: Array<AnnotationMark & { coord: Record<string, string | number> }> = []
  for (const highlight of highlights) {
    const color = palette.tones[highlight.tone ?? 'neutral']
    if ('from' in highlight) bands.push({ ...highlight, color, position: 'insideTop' })
    else
      lines.push({
        label: highlight.label,
        color,
        position: verticalTop(option),
        coord: { xAxis: highlight.at },
      })
  }
  for (const threshold of thresholds) {
    const axis = valueAxisKey(option)
    lines.push({
      label: threshold.label,
      color: palette.tones[threshold.tone ?? 'neutral'],
      position: axis === 'xAxis' ? verticalTop(option) : 'insideEndTop',
      coord: { [axis]: threshold.value },
    })
  }

  const band = (mark: (typeof bands)[number], visible: boolean) => [
    {
      name: mark.label ?? '',
      xAxis: mark.from,
      itemStyle: { color: mark.color, opacity: visible ? BAND_OPACITY : 0 },
      label: visible ? { show: false } : markLabel(mark),
    },
    { xAxis: mark.to },
  ]
  const line = (mark: (typeof lines)[number], visible: boolean) => ({
    name: mark.label ?? '',
    ...mark.coord,
    lineStyle: { color: mark.color, type: 'dashed', width: 1, opacity: visible ? 1 : 0 },
    label: visible ? { show: false } : markLabel(mark),
  })
  const markArea = (marks: typeof bands, visible: boolean) =>
    marks.length > 0 && { markArea: { silent: true, data: marks.map((m) => band(m, visible)) } }
  const markLine = (marks: typeof lines, visible: boolean) =>
    marks.length > 0 && {
      markLine: {
        silent: true,
        symbol: ['none', 'none'],
        z: 1,
        data: marks.map((m) => line(m, visible)),
      },
    }

  const labelled = <T extends AnnotationMark>(marks: T[]) => marks.filter((mark) => mark.label)
  const labelSeries = [
    ...(labelled(bands).length + labelled(lines).length > 0
      ? [
          {
            id: CHART_ANNOTATION_SERIES_ID,
            type: 'line',
            ...filterUndefined({
              xAxisIndex: first.xAxisIndex,
              yAxisIndex: first.yAxisIndex,
              xAxisId: first.xAxisId,
              yAxisId: first.yAxisId,
            }),
            data: [],
            silent: true,
            z: 3,
            tooltip: { show: false },
            ...markArea(labelled(bands), false),
            ...markLine(labelled(lines), false),
          },
        ]
      : []),
  ]
  return {
    ...option,
    series: [
      { ...first, ...markArea(bands, true), ...markLine(lines, true) },
      ...series.slice(1),
      ...labelSeries,
    ],
  }
}
