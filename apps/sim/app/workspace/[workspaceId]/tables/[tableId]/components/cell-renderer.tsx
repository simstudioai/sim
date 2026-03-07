import type { ColumnDefinition } from '@/lib/table'
import { STRING_TRUNCATE_LENGTH } from '../lib/constants'
import type { CellViewerData } from '../lib/types'
import { InlineCellEditor } from './inline-cell-editor'

interface CellRendererProps {
  value: unknown
  column: ColumnDefinition
  isEditing: boolean
  onCellClick: (columnName: string, value: unknown, type: CellViewerData['type']) => void
  onDoubleClick: () => void
  onSave: (value: unknown) => void
  onCancel: () => void
  onBooleanToggle: () => void
}

export function CellRenderer({
  value,
  column,
  isEditing,
  onCellClick,
  onDoubleClick,
  onSave,
  onCancel,
  onBooleanToggle,
}: CellRendererProps) {
  if (isEditing) {
    return <InlineCellEditor value={value} column={column} onSave={onSave} onCancel={onCancel} />
  }

  const isNull = value === null || value === undefined

  if (column.type === 'boolean') {
    const boolValue = Boolean(value)
    return (
      <button
        type='button'
        className='cursor-pointer select-none'
        onClick={(e) => {
          e.stopPropagation()
          onBooleanToggle()
        }}
      >
        <span className={boolValue ? 'text-green-500' : 'text-[var(--text-tertiary)]'}>
          {isNull ? (
            <span className='text-[var(--text-muted)] italic'>—</span>
          ) : boolValue ? (
            'true'
          ) : (
            'false'
          )}
        </span>
      </button>
    )
  }

  if (isNull) {
    return (
      <span
        className='cursor-text text-[var(--text-muted)] italic'
        onDoubleClick={(e) => {
          e.stopPropagation()
          onDoubleClick()
        }}
      >
        —
      </span>
    )
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
        onDoubleClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDoubleClick()
        }}
        title='Click to view, double-click to edit'
      >
        {jsonStr}
      </button>
    )
  }

  if (column.type === 'number') {
    return (
      <span
        className='cursor-text font-mono text-[12px] text-[var(--text-secondary)]'
        onDoubleClick={(e) => {
          e.stopPropagation()
          onDoubleClick()
        }}
      >
        {String(value)}
      </span>
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
        <span
          className='cursor-text text-[12px] text-[var(--text-secondary)]'
          onDoubleClick={(e) => {
            e.stopPropagation()
            onDoubleClick()
          }}
        >
          {formatted}
        </span>
      )
    } catch {
      return (
        <span
          className='cursor-text text-[var(--text-primary)]'
          onDoubleClick={(e) => {
            e.stopPropagation()
            onDoubleClick()
          }}
        >
          {String(value)}
        </span>
      )
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
        onDoubleClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDoubleClick()
        }}
        title='Click to view, double-click to edit'
      >
        {strValue}
      </button>
    )
  }

  return (
    <span
      className='cursor-text text-[var(--text-primary)]'
      onDoubleClick={(e) => {
        e.stopPropagation()
        onDoubleClick()
      }}
    >
      {strValue}
    </span>
  )
}
