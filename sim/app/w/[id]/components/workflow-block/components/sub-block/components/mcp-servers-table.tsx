import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDisplayText } from '@/components/ui/formatted-text'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useSubBlockValue } from '../hooks/use-sub-block-value'

interface MCPServersTableProps {
  columns: string[]
  blockId: string
  subBlockId: string
}

interface TableRow {
  id: string
  cells: Record<string, string>
}

export function MCPServersTable({ columns, blockId, subBlockId }: MCPServersTableProps) {
  const [value, setValue] = useSubBlockValue(blockId, subBlockId)
  const [inputValue, setInputValue] = useState('')

  // Ensure value is properly typed and initialized
  const rows = useMemo(() => {
    if (!Array.isArray(value)) {
      return [] as TableRow[]
    }
    // Ensure each row has all required columns initialized
    return (value as TableRow[]).map(row => ({
      ...row,
      cells: columns.reduce((acc, col) => ({
        ...acc,
        [col]: row.cells?.[col] || ''
      }), {})
    }))
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
    setValue(updatedRows)
  }

  const handleDeleteRow = (rowIndex: number) => {
    setValue(rows.filter((_, index) => index !== rowIndex))
  }

  const addNewRow = () => {
    if (!inputValue.trim()) return
    
    // Validate URL format
    try {
      new URL(inputValue)
    } catch (e) {
      // Could add error feedback here
      return
    }
    
    // Initialize all columns with empty strings, then set the URL
    const newRow = {
      id: crypto.randomUUID(),
      cells: columns.reduce((acc, col) => ({
        ...acc,
        [col]: col === 'url' ? inputValue : ''
      }), {})
    }
    
    setValue([...rows, newRow])
    setInputValue('')
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

  const renderCell = (row: TableRow, rowIndex: number, column: string, cellIndex: number) => {
    const cellValue = row.cells[column] || ''

    return (
      <td
        key={`${row.id}-${column}`}
        className={cn('p-1 relative', cellIndex < columns.length - 1 && 'border-r')}
      >
        <div className="relative">
          <Input
            value={cellValue}
            placeholder={column}
            onChange={(e) => {
              handleCellChange(rowIndex, column, e.target.value)
            }}
            className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0 text-transparent caret-foreground placeholder:text-muted-foreground/50"
          />
          <div className="absolute inset-0 pointer-events-none px-3 flex items-center overflow-x-auto whitespace-pre scrollbar-none text-sm bg-transparent">
            {formatDisplayText(cellValue)}
          </div>
        </div>
      </td>
    )
  }

  const renderDeleteButton = (rowIndex: number) => (
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

  // If we have no rows, show an initial form
  if (rows.length === 0) {
    return (
      <div className="space-y-2">
        <div className="border rounded-md p-2">
          <div className="flex space-x-2">
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder="Enter MCP server URL"
              className="flex-1"
            />
            <Button onClick={addNewRow} disabled={!inputValue.trim()}>Add</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
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

      <div className="flex items-center gap-2 mt-2">
        <Input
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Enter MCP server URL"
          className="flex-1"
        />
        <Button
          onClick={addNewRow} 
          disabled={!inputValue.trim()} 
          size="sm"
          className="flex items-center gap-1"
        >
          <Plus className="h-4 w-4" />
          Add More
        </Button>
      </div>
    </div>
  )
} 