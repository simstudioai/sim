import { formatChartTimestamp } from '@sim/emcn'

interface ChartDataTableProps {
  label: string
  series: { label: string; data: { timestamp: string; value: number }[] }[]
  timeZone?: string
}

/** Exposes exact chart values without requiring pointer interaction. */
export function ChartDataTable({ label, series, timeZone }: ChartDataTableProps) {
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
            <th key={item.label} scope='col'>
              {item.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {timestamps.map((timestamp) => (
          <tr key={timestamp}>
            <th scope='row'>{formatChartTimestamp(timestamp, timeZone)}</th>
            {series.map((item, index) => (
              <td key={item.label}>{values[index].get(timestamp)?.toLocaleString() ?? '—'}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
