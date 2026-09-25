import { isRecordLike, toRecord } from '@sim/utils/object'
import { CHART_BAR_MAX_WIDTH } from '@/lib/charts/option'
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
  valueFormatter?: string
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
      return `${label}: ${formatChartValue(value, valueFormatter)}`
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
    const valueAxis = option[`${valueAxisName}Axis`]
    const formatter = toRecord(
      toRecord(Array.isArray(valueAxis) ? valueAxis[0] : valueAxis).axisLabel
    ).formatter
    const tooltip = toRecord(option.tooltip)
    option.tooltip = {
      trigger: 'axis',
      showContent: true,
      formatter: (params: unknown) =>
        formatBarTooltip(
          params,
          valueAxisName,
          typeof formatter === 'string' ? formatter : undefined
        ),
      ...tooltip,
      axisPointer: { type: 'shadow', ...toRecord(tooltip.axisPointer) },
    }
  } else if (series.length && series.every((entry) => toRecord(entry).type === 'pie')) {
    const valueFields = series.map((entry) => {
      const encoded = toRecord(toRecord(entry).encode).value
      return Array.isArray(encoded) ? encoded[0] : encoded
    })
    /** Native formatting handles automatic encodings; table charts supply named measures. */
    if (!valueFields.every((field): field is string => typeof field === 'string')) return option
    option.tooltip = {
      trigger: 'item',
      formatter: (params: unknown) =>
        formatPieTooltip(params, valueFields[Number(toRecord(params).seriesIndex)]),
      ...toRecord(option.tooltip),
    }
  }
  return option
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
    color: [text, token('--text-icon'), token('--surface-7'), token('--text-subtle')],
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
      label: { fontFamily, fontSize: 13, color: text },
      itemStyle: { borderColor: token('--bg'), borderWidth: 2 },
    },
  }
}
