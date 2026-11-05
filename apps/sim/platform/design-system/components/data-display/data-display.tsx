import type { ReactNode } from 'react'
import styles from '@/platform/design-system/components/data-display/data-display.module.css'
import { ScrollArea } from '@/platform/design-system/components/scroll-area/scroll-area'

interface MetricGroupProps {
  metrics: readonly { label: string; value: string | number }[]
}

export function MetricGroup({ metrics }: MetricGroupProps) {
  return (
    <dl className={styles.metrics}>
      {metrics.map(({ label, value }) => (
        <div className={styles.metric} key={label}>
          <dt data-type='T050'>{label}</dt>
          <dd data-type='T102'>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

type TableColumn = { key: string; label: string; showFrom?: 'compact' | 'wide' } & (
  | { kind: 'text' | 'status' | 'number' | 'percent' }
  | { kind: 'duration'; unit: 'millisecond' | 'second' | 'minute' | 'hour' | 'day' }
  | { kind: 'currency'; currency: string }
)

interface DataTableProps {
  title: string
  control?: ReactNode
  locale?: string
  columns: readonly TableColumn[]
  rows: readonly { id: string; values: Readonly<Partial<Record<string, string | number | null>>> }[]
}

function columnFormat(column: TableColumn, locale: string) {
  switch (column.kind) {
    case 'percent':
      return new Intl.NumberFormat(locale, {
        style: 'percent',
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })
    case 'currency':
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: column.currency,
        minimumFractionDigits: 0,
      })
    case 'duration':
      return new Intl.NumberFormat(locale, { style: 'unit', unit: column.unit })
    case 'number':
      return new Intl.NumberFormat(locale)
    default:
      return null
  }
}

function cellText(value: string | number | null | undefined, format: Intl.NumberFormat | null) {
  if (format)
    return typeof value === 'number' && Number.isFinite(value) ? format.format(value) : '—'
  return value === '' || value == null ? '—' : value
}

export function DataTable({ title, control, locale = 'en-US', columns, rows }: DataTableProps) {
  const fields = columns.map((column) => ({ ...column, format: columnFormat(column, locale) }))
  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <h2 data-type='T042'>{title}</h2>
        {control}
      </header>
      <div className={styles.tableViewport}>
        <ScrollArea label={title} axis='horizontal'>
          <table className={styles.table} aria-label={title}>
            <thead>
              <tr>
                {fields.map((column) => (
                  <th
                    key={column.key}
                    scope='col'
                    data-kind={column.kind}
                    data-from={column.showFrom}
                    data-numeric={Boolean(column.format)}
                    data-type='T050'
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  {fields.map((column) => (
                    <td
                      key={column.key}
                      data-kind={column.kind}
                      data-from={column.showFrom}
                      data-numeric={Boolean(column.format)}
                      data-type={column.kind === 'text' ? 'T059' : 'T060'}
                    >
                      {cellText(row.values[column.key], column.format)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </div>
    </section>
  )
}
