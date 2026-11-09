import { isRecordLike, toRecord } from '@sim/utils/object'
import { mapTooltipEntries } from '@/lib/charts/option'
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
