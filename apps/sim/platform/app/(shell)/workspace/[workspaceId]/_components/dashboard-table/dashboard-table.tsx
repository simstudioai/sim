import { DataTable } from '@sim/emcn/data-display'
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

function number(value: DashboardCell | undefined) {
  return typeof value === 'number' ? value : null
}

/** The workspace's own value formats, so counts, durations and deltas read as they do elsewhere. */
function cell(column: DashboardColumn, value: DashboardCell | undefined) {
  if (value != null && typeof value === 'object')
    return (
      <span className={styles.status} data-tone={value.tone}>
        {value.label}
      </span>
    )
  switch (column.kind) {
    case 'number':
      return formatCount(number(value))
    case 'percent':
      return formatPercent(number(value))
    case 'duration':
      return formatDuration(number(value))
    case 'currency':
      return formatCurrency(number(value), column.currency)
    case 'delta':
      return formatDelta(number(value))
    default:
      return value == null || value === '' ? '—' : String(value)
  }
}

/**
 * A read-only typed table on EMCN DataTable, the owner Paper names for it. Numbers align to the end
 * and later columns leave as the table narrows, so values wrap rather than scroll.
 */
export function DashboardTable({ label, columns, rows }: DashboardTableProps) {
  return (
    <DataTable
      title={label}
      titleHidden
      columns={columns.map((column, index) => ({
        key: column.key,
        label: column.label,
        primary: column.primary,
        showFrom: index >= 4 ? 'wide' : index === 3 ? 'compact' : undefined,
        kind: column.kind === 'text' || column.kind === 'status' ? column.kind : 'number',
      }))}
      rows={rows.map((row) => ({
        id: row.id,
        values: {},
        cells: Object.fromEntries(
          columns.map((column) => [column.key, cell(column, row.values[column.key])])
        ),
      }))}
    />
  )
}
