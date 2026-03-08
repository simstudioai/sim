import React from 'react'
import { Checkbox, TableCell, TableRow } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import type { ColumnDefinition, TableRow as TableRowType } from '@/lib/table'
import type { CellViewerData } from '../../types'
import { CellRenderer } from '../cell-renderer'

interface TableRowCellsProps {
  row: TableRowType
  columns: ColumnDefinition[]
  isSelected: boolean
  editingColumnName: string | null
  onCellClick: (columnName: string, value: unknown, type: CellViewerData['type']) => void
  onDoubleClick: (rowId: string, columnName: string) => void
  onSave: (rowId: string, columnName: string, value: unknown) => void
  onCancel: () => void
  onBooleanToggle: (rowId: string, columnName: string, currentValue: boolean) => void
  onContextMenu: (e: React.MouseEvent, row: TableRowType) => void
  onSelectRow: (rowId: string) => void
}

export const TableRowCells = React.memo(function TableRowCells({
  row,
  columns,
  isSelected,
  editingColumnName,
  onCellClick,
  onDoubleClick,
  onSave,
  onCancel,
  onBooleanToggle,
  onContextMenu,
  onSelectRow,
}: TableRowCellsProps) {
  return (
    <TableRow
      className={cn('group hover:bg-[var(--surface-4)]', isSelected && 'bg-[var(--surface-5)]')}
      onContextMenu={(e) => onContextMenu(e, row)}
    >
      <TableCell>
        <Checkbox size='sm' checked={isSelected} onCheckedChange={() => onSelectRow(row.id)} />
      </TableCell>
      {columns.map((column) => (
        <TableCell key={column.name}>
          <div className='max-w-[300px] truncate text-[13px]'>
            <CellRenderer
              value={row.data[column.name]}
              column={column}
              isEditing={editingColumnName === column.name}
              onCellClick={onCellClick}
              onDoubleClick={() => onDoubleClick(row.id, column.name)}
              onSave={(value) => onSave(row.id, column.name, value)}
              onCancel={onCancel}
              onBooleanToggle={() =>
                onBooleanToggle(row.id, column.name, Boolean(row.data[column.name]))
              }
            />
          </div>
        </TableCell>
      ))}
    </TableRow>
  )
})
