import { memo } from 'react'
import { formatChartDate, formatChartTimestamp } from '@sim/emcn'

interface ChartDataTableProps {
  label: string
  series: { id: string; label: string; data: { timestamp: string; value: number }[] }[]
  timeZone?: string
  /** `date` for calendar buckets, whose time of day means nothing. */
  xAxisFormat?: 'auto' | 'date'
}

/**
 * Exposes exact chart values without requiring pointer interaction. Memoized: the
 * chart around it re-renders on every pointer move, and its cells never change then.
 */
export const ChartDataTable = memo(function ChartDataTable({
  label,
  series,
  timeZone,
  xAxisFormat,
}: ChartDataTableProps) {
  const formatRow = xAxisFormat === 'date' ? formatChartDate : formatChartTimestamp
  const values = series.map(
    (item) => new Map(item.data.map((point) => [point.timestamp, point.value]))
  )
  const timestamps = [
    ...new Set(series.flatMap((item) => item.data.map((point) => point.timestamp))),
  ]
  return (
    <table className='sr-only'>
      <caption>{label}</caption>
      <thead>
        <tr>
          <th scope='col'>Date</th>
          {series.map((item) => (
            <th key={item.id} scope='col'>
              {item.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {timestamps.map((timestamp) => (
          <tr key={timestamp}>
            <th scope='row'>{formatRow(timestamp, timeZone)}</th>
            {series.map((item, index) => (
              <td key={item.id}>
                {values[index]
                  .get(timestamp)
                  ?.toLocaleString(undefined, { maximumSignificantDigits: 21 }) ?? '—'}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
})
