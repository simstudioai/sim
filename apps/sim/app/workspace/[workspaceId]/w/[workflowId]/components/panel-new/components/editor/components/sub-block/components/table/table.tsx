import { useMemo, useRef } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/emcn/components/button/button'
import { Trash } from '@/components/emcn/icons/trash'
import { Input } from '@/components/ui/input'
import { createLogger } from '@/lib/logs/console/logger'
import { cn } from '@/lib/utils'
import { EnvVarDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/env-var-dropdown'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/formatted-text'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'

const logger = createLogger('Table')

interface TableProps {
  blockId: string
  subBlockId: string
  columns: string[]
  isPreview?: boolean
  previewValue?: TableRow[] | null
  disabled?: boolean
}

interface TableRow {
  id: string
  cells: Record<string, string>
}

export function Table({
  blockId,
  subBlockId,
  columns,
  isPreview = false,
  previewValue,
  disabled = false,
}: TableProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [storeValue, setStoreValue] = useSubBlockValue<TableRow[]>(blockId, subBlockId)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  // Use the extended hook for field-level management
  const inputController = useSubBlockInput({
    blockId,
    subBlockId,
    config: {
      id: subBlockId,
      type: 'table',
      connectionDroppable: true,
    },
    isPreview,
    disabled,
  })

  // Use preview value when in preview mode, otherwise use store value
  const value = isPreview ? previewValue : storeValue

  // Create refs for input elements
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map())

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

    // Validate and fix each row to ensure proper structure
    const validatedRows = value.map((row) => {
      // Ensure row has an id
      if (!row.id) {
        row.id = crypto.randomUUID()
      }

      // Ensure row has cells object with proper structure
      if (!row.cells || typeof row.cells !== 'object') {
        logger.warn('Fixing malformed table row:', row)
        row.cells = Object.fromEntries(columns.map((col) => [col, '']))
      } else {
        // Ensure all required columns exist in cells
        columns.forEach((col) => {
          if (!(col in row.cells)) {
            row.cells[col] = ''
          }
        })
      }

      return row
    })

    return validatedRows as TableRow[]
  }, [value, columns])

  // Helper to update a cell value
  const updateCellValue = (rowIndex: number, column: string, newValue: string) => {
    if (isPreview || disabled) return

    const updatedRows = [...rows].map((row, idx) => {
      if (idx === rowIndex) {
        // Ensure the row has a proper cells object
        if (!row.cells || typeof row.cells !== 'object') {
          logger.warn('Fixing malformed row cells during cell change:', row)
          row.cells = Object.fromEntries(columns.map((col) => [col, '']))
        }

        return {
          ...row,
          cells: { ...row.cells, [column]: newValue },
        }
      }
      return row
    })

    if (rowIndex === rows.length - 1 && newValue !== '') {
      updatedRows.push({
        id: crypto.randomUUID(),
        cells: Object.fromEntries(columns.map((col) => [col, ''])),
      })
    }

    setStoreValue(updatedRows)
  }

  const handleDeleteRow = (rowIndex: number) => {
    if (isPreview || disabled || rows.length === 1) return
    setStoreValue(rows.filter((_, index) => index !== rowIndex))
  }

  const renderHeader = () => (
    <thead className='bg-transparent'>
      <tr className='border-[var(--border-strong)] border-b bg-transparent'>
        {columns.map((column, index) => (
          <th
            key={column}
            className={cn(
              'bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]',
              index < columns.length - 1 && 'border-[var(--border-strong)] border-r'
            )}
          >
            {column}
          </th>
        ))}
      </tr>
    </thead>
  )

  const renderCell = (row: TableRow, rowIndex: number, column: string, cellIndex: number) => {
    // Defensive programming: ensure row.cells exists and has the expected structure
    if (!row.cells || typeof row.cells !== 'object') {
      logger.warn('Table row has malformed cells data:', row)
      // Create a fallback cells object
      row = {
        ...row,
        cells: Object.fromEntries(columns.map((col) => [col, ''])),
      }
    }

    const cellValue = row.cells[column] || ''
    const cellKey = `${rowIndex}-${column}`

    // Get field state and handlers for this cell
    const fieldState = inputController.fieldHelpers.getFieldState(cellKey)
    const handlers = inputController.fieldHelpers.createFieldHandlers(
      cellKey,
      cellValue,
      (newValue) => updateCellValue(rowIndex, column, newValue)
    )
    const tagSelectHandler = inputController.fieldHelpers.createTagSelectHandler(
      cellKey,
      cellValue,
      (newValue) => updateCellValue(rowIndex, column, newValue)
    )
    const envVarSelectHandler = inputController.fieldHelpers.createEnvVarSelectHandler(
      cellKey,
      cellValue,
      (newValue) => updateCellValue(rowIndex, column, newValue)
    )

    return (
      <td
        key={`${row.id}-${column}`}
        className={cn(
          'relative bg-transparent p-0',
          cellIndex < columns.length - 1 && 'border-[var(--border-strong)] border-r'
        )}
      >
        <div className='relative w-full'>
          <Input
            ref={(el) => {
              if (el) inputRefs.current.set(cellKey, el)
            }}
            value={cellValue}
            placeholder={column}
            onChange={handlers.onChange}
            onKeyDown={handlers.onKeyDown}
            onDrop={handlers.onDrop}
            onDragOver={handlers.onDragOver}
            disabled={isPreview || disabled}
            autoComplete='off'
            className='w-full border-0 bg-transparent px-[10px] py-[8px] text-transparent caret-white placeholder:text-[var(--text-muted)] focus-visible:ring-0 focus-visible:ring-offset-0'
          />
          <div
            data-overlay={cellKey}
            className='pointer-events-none absolute inset-0 flex items-center overflow-hidden bg-transparent px-[10px] font-medium text-[#eeeeee] text-sm'
          >
            <div className='whitespace-pre leading-[21px]'>
              {formatDisplayText(cellValue, {
                accessiblePrefixes,
                highlightAll: !accessiblePrefixes,
              })}
            </div>
          </div>
          {fieldState.showEnvVars && (
            <EnvVarDropdown
              visible={fieldState.showEnvVars}
              onSelect={envVarSelectHandler}
              searchTerm={fieldState.searchTerm}
              inputValue={cellValue}
              cursorPosition={fieldState.cursorPosition}
              workspaceId={workspaceId}
              onClose={() => inputController.fieldHelpers.hideFieldDropdowns(cellKey)}
              inputRef={
                {
                  current: inputRefs.current.get(cellKey) || null,
                } as React.RefObject<HTMLInputElement>
              }
            />
          )}
          {fieldState.showTags && (
            <TagDropdown
              visible={fieldState.showTags}
              onSelect={tagSelectHandler}
              blockId={blockId}
              activeSourceBlockId={fieldState.activeSourceBlockId}
              inputValue={cellValue}
              cursorPosition={fieldState.cursorPosition}
              onClose={() => inputController.fieldHelpers.hideFieldDropdowns(cellKey)}
              inputRef={
                {
                  current: inputRefs.current.get(cellKey) || null,
                } as React.RefObject<HTMLInputElement>
              }
            />
          )}
        </div>
      </td>
    )
  }

  const renderDeleteButton = (rowIndex: number) =>
    rows.length > 1 &&
    !isPreview &&
    !disabled && (
      <td className='w-0 p-0'>
        <Button
          variant='ghost'
          className='-translate-y-1/2 absolute top-1/2 right-[8px] opacity-0 transition-opacity group-hover:opacity-100'
          onClick={() => handleDeleteRow(rowIndex)}
        >
          <Trash className='h-[14px] w-[14px]' />
        </Button>
      </td>
    )

  return (
    <div className='relative'>
      <div className='overflow-visible rounded-[4px] border border-[var(--border-strong)] bg-[#1F1F1F]'>
        <table className='w-full bg-transparent'>
          {renderHeader()}
          <tbody className='bg-transparent'>
            {rows.map((row, rowIndex) => (
              <tr
                key={row.id}
                className='group relative border-[var(--border-strong)] border-t bg-transparent'
              >
                {columns.map((column, cellIndex) => renderCell(row, rowIndex, column, cellIndex))}
                {renderDeleteButton(rowIndex)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
