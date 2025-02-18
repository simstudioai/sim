import { useEffect, useMemo, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

interface TableProps {
  columns: string[]
  blockId: string
  subBlockId: string
}

interface TableRow {
  id: string
  cells: Record<string, string>
}

export function Table({ columns, blockId, subBlockId }: TableProps) {
  const [value, setValue] = useSubBlockValue(blockId, subBlockId)

  // Ensure value is properly typed and initialized
  const rows = useMemo(() => {
    if (!Array.isArray(value)) {
      return [
        {
          id: crypto.randomUUID(),
          cells: Object.fromEntries(columns.map((col) => [col, ''])),
        },
      ]
    }
    return value as TableRow[]
  }, [value, columns])

  const handleCellChange = (rowIndex: number, column: string, value: string) => {
    const updatedRows = [...rows].map((row, idx) =>
      idx === rowIndex
        ? {
            ...row,
            cells: { ...row.cells, [column]: value },
          }
        : row
    )

    if (rowIndex === rows.length - 1 && value !== '') {
      updatedRows.push({
        id: crypto.randomUUID(),
        cells: Object.fromEntries(columns.map((col) => [col, ''])),
      })
    }

    setValue(updatedRows)
  }

  const handleDeleteRow = (rowIndex: number) => {
    if (rows.length === 1) return
    setValue(rows.filter((_, index) => index !== rowIndex))
  }

  const renderHeader = () => (
    <thead>
      <tr className="border-b">
        {columns.map((column, index) => (
          <th
            key={column}
            className={cn(
              'px-4 py-2 text-left text-sm font-medium',
              index < columns.length - 1 && 'border-r'
            )}
          >
            {column}
          </th>
        ))}
      </tr>
    </thead>
  )

  const renderCell = (row: TableRow, rowIndex: number, column: string, cellIndex: number) => (
    <td
      key={`${row.id}-${column}`}
      className={cn('p-1', cellIndex < columns.length - 1 && 'border-r')}
    >
      <Input
        value={row.cells[column] || ''}
        placeholder={column}
        onChange={(e) => handleCellChange(rowIndex, column, e.target.value)}
        className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-muted-foreground placeholder:text-muted-foreground/50"
      />
    </td>
  )

  const renderDeleteButton = (rowIndex: number) =>
    rows.length > 1 && (
      <td className="w-0 p-0">
        <Button
          variant="ghost"
          size="icon"
          className="opacity-0 group-hover:opacity-100 h-8 w-8 absolute right-2 top-1/2 -translate-y-1/2"
          onClick={() => handleDeleteRow(rowIndex)}
        >
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      </td>
    )

  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full">
        {renderHeader()}
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={row.id} className="border-t group relative">
              {columns.map((column, cellIndex) => renderCell(row, rowIndex, column, cellIndex))}
              {renderDeleteButton(rowIndex)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
