/**
 * Cell value renderer for different column types.
 *
 * @module tables/[tableId]/table-data-viewer/components/table-cell-renderer
 */

import type { ColumnDefinition } from '@/lib/table'
import { STRING_TRUNCATE_LENGTH } from '../constants'
import type { CellViewerData } from '../types'

interface TableCellRendererProps {
  value: unknown
  column: ColumnDefinition
  onCellClick: (columnName: string, value: unknown, type: CellViewerData['type']) => void
}

/**
 * Renders a cell value with appropriate formatting based on column type.
 *
 * @param props - Component props
 * @returns Formatted cell content
 */
export function TableCellRenderer({ value, column, onCellClick }: TableCellRendererProps) {
  const isNull = value === null || value === undefined

  if (isNull) {
    return <span className='text-[var(--text-muted)] italic'>—</span>
  }

  if (column.type === 'json') {
    const jsonStr = JSON.stringify(value)
    return (
      <button
        type='button'
        className='block max-w-[300px] cursor-pointer select-none truncate rounded-[4px] border border-[var(--border-1)] px-[6px] py-[2px] text-left font-mono text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--text-muted)] hover:text-[var(--text-primary)]'
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onCellClick(column.name, value, 'json')
        }}
        title='Click to view full JSON'
      >
        {jsonStr}
      </button>
    )
  }

  if (column.type === 'boolean') {
    const boolValue = Boolean(value)
    return (
      <span className={boolValue ? 'text-green-500' : 'text-[var(--text-tertiary)]'}>
        {boolValue ? 'true' : 'false'}
      </span>
    )
  }

  if (column.type === 'number') {
    return (
      <span className='font-mono text-[12px] text-[var(--text-secondary)]'>{String(value)}</span>
    )
  }

  if (column.type === 'date') {
    try {
      const date = new Date(String(value))
      const formatted = date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
      return (
        <button
          type='button'
          className='cursor-pointer select-none text-left text-[12px] text-[var(--text-secondary)] underline decoration-[var(--border-1)] decoration-dotted underline-offset-2 transition-colors hover:text-[var(--text-primary)] hover:decoration-[var(--text-muted)]'
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onCellClick(column.name, value, 'date')
          }}
          title='Click to view ISO format'
        >
          {formatted}
        </button>
      )
    } catch {
      return <span className='text-[var(--text-primary)]'>{String(value)}</span>
    }
  }

  const strValue = String(value)
  if (strValue.length > STRING_TRUNCATE_LENGTH) {
    return (
      <button
        type='button'
        className='block max-w-[300px] cursor-pointer select-none truncate text-left text-[var(--text-primary)] underline decoration-[var(--border-1)] decoration-dotted underline-offset-2 transition-colors hover:decoration-[var(--text-muted)]'
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onCellClick(column.name, value, 'text')
        }}
        title='Click to view full text'
      >
        {strValue}
      </button>
    )
  }

  return <span className='text-[var(--text-primary)]'>{strValue}</span>
}
