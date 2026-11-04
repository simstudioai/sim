import type { ReactNode } from 'react'
import { ScrollArea } from '@/platform/design-system/components/scroll-area'
import styles from '@/platform/design-system/components/workspace.module.css'

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

interface DataTableProps {
  title: string
  control?: ReactNode
  columns: readonly {
    key: string
    label: string
    kind: 'text' | 'number' | 'duration' | 'currency'
  }[]
  rows: readonly { id: string; values: Readonly<Record<string, string | number>> }[]
}

export function DataTable({ title, control, columns, rows }: DataTableProps) {
  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <h2 data-type='T042'>{title}</h2>
        {control}
      </header>
      <ScrollArea label={title} axis='horizontal'>
        <table className={styles.table} aria-label={title}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope='col' data-kind={column.kind} data-type='T050'>
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    data-kind={column.kind}
                    data-type={column.kind === 'text' ? 'T059' : 'T060'}
                  >
                    {row.values[column.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
    </section>
  )
}
