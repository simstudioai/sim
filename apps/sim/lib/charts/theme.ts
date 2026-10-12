import { isRecordLike, toRecord } from '@sim/utils/object'
import type { ChartTonePalette } from '@/lib/charts/annotations'
import { CHART_BAR_MAX_WIDTH, mapTooltipEntries } from '@/lib/charts/option'
import { formatChartValue } from '@/lib/charts/summary'

function encodedTooltipValue(entry: Record<string, unknown>, dimension: 'x' | 'y' | 'value') {
  const dimensions = Array.isArray(entry.dimensionNames) ? entry.dimensionNames : []
  const encoded = toRecord(entry.encode)[dimension]
  const indices = Array.isArray(encoded) ? encoded : []
  if (!indices.length) return entry.value
  const index = indices[0]
  return Array.isArray(entry.value)
    ? entry.value[index]
    : isRecordLike(entry.value)
      ? entry.value[dimensions[index]]
      : entry.value
}

/** A single category/value line avoids ECharts' empty series-name row for unnamed bars. */
export function formatBarTooltip(
  params: unknown,
  valueAxis: 'x' | 'y' = 'y',
  valueFormatter?: string | ((seriesIndex: number) => string | undefined)
): string {
  const entries = (Array.isArray(params) ? params : [params]).filter(isRecordLike)
  return entries
    .map((entry) => {
      const value = encodedTooltipValue(entry, valueAxis)
      const category = entry.axisValueLabel ?? entry.name ?? ''
      const name =
        typeof entry.seriesName === 'string' && !entry.seriesName.includes('\u0000')
          ? entry.seriesName
          : ''
      const label = entries.length > 1 && name ? `${category} · ${name}` : category || name
      const formatter =
        typeof valueFormatter === 'function'
          ? valueFormatter(Number(entry.seriesIndex ?? 0))
          : valueFormatter
      return `${label}: ${formatChartValue(value, formatter)}`
    })
    .join('\n')
}

/** Dataset-backed pies expose the whole source row as value; resolve the encoded measure. */
export function formatPieTooltip(params: unknown, valueField?: string): string {
  const entry = toRecord(params)
  const value = formatChartValue(
    valueField && isRecordLike(entry.value)
      ? entry.value[valueField]
      : encodedTooltipValue(entry, 'value')
  )
  const percent = typeof entry.percent === 'number' ? ` (${formatChartValue(entry.percent)}%)` : ''
  return `${entry.name}: ${value}${percent}`
}

/** Authored tooltip options take precedence over the shared chart defaults. */
export function applyChartTooltipDefaults(option: Record<string, unknown>) {
  const series = Array.isArray(option.series) ? option.series : [option.series]
  if (series.length && series.every((entry) => toRecord(entry).type === 'bar')) {
    const yAxis = toRecord(Array.isArray(option.yAxis) ? option.yAxis[0] : option.yAxis)
    const valueAxisName = yAxis.type === 'category' ? 'x' : 'y'
    const valueAxes = option[`${valueAxisName}Axis`]
    /** Each series reads units from its own value axis, so a secondary axis keeps its format. */
    const formatters = series.map((entry) => {
      const index = Number(toRecord(entry)[`${valueAxisName}AxisIndex`] ?? 0)
      const axis = toRecord(Array.isArray(valueAxes) ? valueAxes[index] : valueAxes)
      const formatter = toRecord(axis.axisLabel).formatter
      return typeof formatter === 'string' ? formatter : undefined
    })
    option.tooltip = mapTooltipEntries(option.tooltip, (tooltip) => ({
      trigger: 'axis',
      showContent: true,
      formatter: (params: unknown) =>
        formatBarTooltip(params, valueAxisName, (seriesIndex) => formatters[seriesIndex]),
      ...tooltip,
      axisPointer: { type: 'shadow', ...toRecord(tooltip.axisPointer) },
    }))
  } else if (series.length && series.every((entry) => toRecord(entry).type === 'pie')) {
    const valueFields = series.map((entry) => {
      const encoded = toRecord(toRecord(entry).encode).value
      return Array.isArray(encoded) ? encoded[0] : encoded
    })
    /**
     * Native formatting handles automatic encodings. Table charts name their measure; indexed
     * encodings resolve through the encode and dimension names ECharts passes the formatter.
     */
    if (!valueFields.every((field) => typeof field === 'string' || typeof field === 'number'))
      return option
    option.tooltip = mapTooltipEntries(option.tooltip, (tooltip) => ({
      trigger: 'item',
      formatter: (params: unknown) => {
        const field = valueFields[Number(toRecord(params).seriesIndex)]
        return formatPieTooltip(params, typeof field === 'string' ? field : undefined)
      },
      ...tooltip,
    }))
  }
  return option
}

/** Colours for highlights and thresholds; neutral matches the axis labels. */
export function readChartTonePalette(element: HTMLElement): ChartTonePalette {
  const styles = getComputedStyle(element)
  const token = (name: string) => {
    const value = styles.getPropertyValue(name).trim()
    if (!value) throw new Error(`Missing chart theme token ${name}`)
    return value
  }
  return {
    tones: {
      neutral: token('--text-tertiary'),
      error: token('--text-error'),
      info: token('--brand-blue'),
    },
  }
}

/** Canvas cannot resolve CSS variables; read the same tokens as EMCN at its own container. */
export function readEmcnChartTheme(element: HTMLElement): Record<string, unknown> {
  const styles = getComputedStyle(element)
  const token = (name: string) => {
    const value = styles.getPropertyValue(name).trim()
    if (!value) throw new Error(`Missing chart theme token ${name}`)
    return value
  }
  const text = token('--text-body')
  const muted = token('--text-tertiary')
  const border = token('--border')
  const fontFamily = styles.fontFamily
  const axis = {
    axisLine: { show: false, lineStyle: { color: border } },
    axisTick: { show: false },
    axisLabel: { color: muted, fontFamily, fontSize: 13, margin: 12, hideOverlap: true },
    nameTextStyle: { color: muted, fontFamily, fontSize: 13 },
    splitLine: { lineStyle: { color: border, width: 0.5, type: 'solid' } },
    splitNumber: 4,
  }
  return {
    color: [text, token('--text-subtle'), token('--surface-7'), token('--text-icon')],
    backgroundColor: 'transparent',
    axisPointer: { shadowStyle: { color: text, opacity: 0.06 } },
    animationDuration: 0,
    textStyle: { fontFamily, fontSize: 13, color: text },
    title: {
      textStyle: { fontFamily, fontSize: 13, fontWeight: 'normal', color: text },
    },
    legend: {
      textStyle: { color: muted, fontFamily, fontSize: 13 },
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 16,
    },
    tooltip: {
      renderMode: 'richText',
      confine: true,
      backgroundColor: token('--surface-1'),
      borderColor: border,
      borderWidth: 1,
      padding: [6, 12],
      borderRadius: 6,
      shadowBlur: 0,
      shadowOffsetX: 0,
      shadowOffsetY: 0,
      textStyle: { fontFamily, color: text, fontSize: 13, fontWeight: 'normal', lineHeight: 20 },
    },
    categoryAxis: { ...axis, splitLine: { show: false } },
    valueAxis: axis,
    timeAxis: { ...axis, splitLine: { show: false } },
    logAxis: axis,
    line: { symbolSize: 4, lineStyle: { width: 1.5 }, showSymbol: false },
    bar: {
      barMaxWidth: CHART_BAR_MAX_WIDTH,
      label: { fontFamily, fontSize: 13, color: text },
      itemStyle: { borderRadius: 2 },
    },
    pie: {
      label: {
        fontFamily,
        fontSize: 13,
        lineHeight: 18,
        color: text,
        alignTo: 'edge',
        edgeDistance: 8,
        overflow: 'break',
      },
      labelLine: { length: 12, length2: 8 },
      itemStyle: { borderColor: token('--bg'), borderWidth: 2 },
    },
  }
}
