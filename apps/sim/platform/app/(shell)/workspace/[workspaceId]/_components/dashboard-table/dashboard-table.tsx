import { OverflowText } from '@sim/emcn/overflow-text'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/_components/dashboard-table/dashboard-table.module.css'
import {
  formatCount,
  formatCurrency,
  formatDelta,
  formatDuration,
  formatPercent,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/format'
import type {
  DashboardCell,
  DashboardColumn,
  DashboardTableData,
} from '@/platform/app/(shell)/workspace/[workspaceId]/_components/workspace-session/model'

interface DashboardTableProps extends DashboardTableData {
  /** Names the table for assistive technology; its section shows the visible title. */
  label: string
}

const NUMERIC = new Set<DashboardColumn['kind']>([
  'number',
  'percent',
  'duration',
  'currency',
  'delta',
])

function cellContent(column: DashboardColumn, value: DashboardCell | undefined) {
  if (value != null && typeof value === 'object')
    return { text: value.label, tone: value.tone, empty: false }
  const text =
    column.kind === 'number'
      ? formatCount(typeof value === 'number' ? value : null)
      : column.kind === 'percent'
        ? formatPercent(typeof value === 'number' ? value : null)
        : column.kind === 'duration'
          ? formatDuration(typeof value === 'number' ? value : null)
          : column.kind === 'currency'
            ? formatCurrency(typeof value === 'number' ? value : null, column.currency)
            : column.kind === 'delta'
              ? formatDelta(typeof value === 'number' ? value : null)
              : value == null || value === ''
                ? '—'
                : String(value)
  return { text, tone: undefined, empty: text === '—' }
}

/**
 * A read-only typed table with DataTable's geometry. Numbers align to the end and text to the
 * start; hovering a row guides the eye across it without making it a target. Lower-priority columns
 * leave as the table narrows, so values wrap rather than scroll.
 */
export function DashboardTable({ label, columns, rows }: DashboardTableProps) {
  return (
    <div className={styles.viewport}>
      <table className={styles.table} aria-label={label}>
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={column.key}
                scope='col'
                data-type='T050'
                data-kind={column.kind}
                data-numeric={NUMERIC.has(column.kind) || undefined}
                data-primary={column.primary || undefined}
                data-rank={Math.min(index, 6)}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column, index) => {
                const { text, tone, empty } = cellContent(column, row.values[column.key])
                return (
                  <td
                    key={column.key}
                    data-type='T060'
                    data-kind={column.kind}
                    data-numeric={NUMERIC.has(column.kind) || undefined}
                    data-primary={column.primary || undefined}
                    data-rank={Math.min(index, 6)}
                    data-tone={tone}
                    data-empty={empty || undefined}
                  >
                    {column.kind === 'status' ? <OverflowText text={text} /> : text}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
