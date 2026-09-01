import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, cn } from '@sim/emcn'
import { Trash } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { useParams } from 'next/navigation'
import { EnvVarDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/env-var-dropdown'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import {
  maskSecretText,
  shouldMaskSecretValue,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/password-mask'
import { TagDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/tag-dropdown/tag-dropdown'
import {
  getActiveWorkflowSearchHighlight,
  getWorkflowSearchLabelHighlight,
} from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useSubBlockInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-input'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'

const logger = createLogger('Table')

interface TableProps {
  blockId: string
  subBlockId: string
  columns: string[]
  /**
   * Conceals the value columns except while a cell is focused. The first column is the
   * key half of a key/value secrets table and stays legible — masking it would
   * leave the user unable to tell the rows apart.
   */
  password?: boolean
  isPreview?: boolean
  previewValue?: WorkflowTableRow[] | null
  disabled?: boolean
}

interface WorkflowTableRow {
  id: string
  cells: Record<string, string>
}

interface TableCellProps {
  row: WorkflowTableRow
  rowIndex: number
  column: string
  cellIndex: number
  columnsCount: number
  /** Whether this cell holds a secret and must be concealed while unfocused */
  password: boolean
  isPreview: boolean
  disabled: boolean
  blockId: string
  inputController: ReturnType<typeof useSubBlockInput>
  updateCellValue: (rowIndex: number, column: string, newValue: string) => void
  inputRefs: React.MutableRefObject<Map<string, HTMLInputElement>>
  overlayRefs: React.MutableRefObject<Map<string, HTMLDivElement>>
  accessiblePrefixes: ReturnType<typeof useAccessibleReferencePrefixes>
  workspaceId: string
  subBlockId: string
}

function TableCell({
  row,
  rowIndex,
  column,
  cellIndex,
  columnsCount,
  password,
  isPreview,
  disabled,
  blockId,
  inputController,
  updateCellValue,
  inputRefs,
  overlayRefs,
  accessiblePrefixes,
  workspaceId,
  subBlockId,
}: TableCellProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const [isFocused, setIsFocused] = useState(false)
  // Defensive programming: ensure row.cells exists and has the expected structure
  const hasValidCells = row.cells && typeof row.cells === 'object'
  if (!hasValidCells) logger.warn('Table row has malformed cells data:', row)

  const cells = hasValidCells ? row.cells : {}

  const cellValue = cells[column] || ''
  const cellKey = `${rowIndex}-${column}`
  const workflowSearchHighlight = getActiveWorkflowSearchHighlight({
    activeSearchTarget,
    blockId,
    subBlockId,
    valuePath: [rowIndex, 'cells', column],
  })

  const shouldMask = shouldMaskSecretValue({ password, isFocused })
  const displayValue = shouldMask ? maskSecretText(cellValue) : cellValue

  // Get field state and handlers for this cell
  const fieldState = inputController.fieldHelpers.getFieldState(cellKey)
  const handlers = inputController.fieldHelpers.createFieldHandlers(
    cellKey,
    cellValue,
    (newValue) => updateCellValue(rowIndex, column, newValue)
  )
  const handleScroll = (e: React.UIEvent<HTMLInputElement>) => {
    const overlay = overlayRefs.current.get(cellKey)
    if (overlay) {
      overlay.scrollLeft = e.currentTarget.scrollLeft
    }
  }

  /**
   * Enter commits the current cell (values already persist on change) and
   * advances to the same column in the next row, spreadsheet-style. Skipped
   * while a tag/env-var dropdown is open (Enter selects an option there) or
   * during IME composition. The next row already exists — it auto-appends the
   * moment the last row is typed into — so focus lands on a real input.
   *
   * Focusing an empty cell auto-opens the tag dropdown, so the destination's
   * dropdown is closed right after focusing: otherwise a follow-up Enter would
   * land on that dropdown and insert a tag instead of continuing down the
   * column. Clicking or typing `<` in the cell still opens it deliberately.
   */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    handlers.onKeyDown(e)
    if (
      e.key !== 'Enter' ||
      e.nativeEvent.isComposing ||
      e.defaultPrevented ||
      fieldState.showEnvVars ||
      fieldState.showTags
    ) {
      return
    }
    const nextCellKey = `${rowIndex + 1}-${column}`
    const nextInput = inputRefs.current.get(nextCellKey)
    // `isConnected` guards against a stale ref: position-keyed entries can
    // outlive a deleted row, and focusing a detached node would steal focus
    // from the current cell. A real next row's input is always connected.
    if (nextInput?.isConnected) {
      e.preventDefault()
      nextInput.focus()
      inputController.fieldHelpers.hideFieldDropdowns(nextCellKey)
    }
  }

  const syncScrollAfterUpdate = () => {
    requestAnimationFrame(() => {
      const input = inputRefs.current.get(cellKey)
      const overlay = overlayRefs.current.get(cellKey)
      if (input && overlay) {
        overlay.scrollLeft = input.scrollLeft
      }
    })
  }

  const baseTagSelectHandler = inputController.fieldHelpers.createTagSelectHandler(
    cellKey,
    cellValue,
    (newValue) => updateCellValue(rowIndex, column, newValue)
  )
  const tagSelectHandler = (tag: string) => {
    baseTagSelectHandler(tag)
    syncScrollAfterUpdate()
  }

  const baseEnvVarSelectHandler = inputController.fieldHelpers.createEnvVarSelectHandler(
    cellKey,
    cellValue,
    (newValue) => updateCellValue(rowIndex, column, newValue)
  )
  const envVarSelectHandler = (envVar: string) => {
    baseEnvVarSelectHandler(envVar)
    syncScrollAfterUpdate()
  }

  return (
    <td
      className={cn(
        'relative bg-transparent p-0',
        cellIndex < columnsCount - 1 && 'border-[var(--border-1)] border-r'
      )}
    >
      <div className='relative w-full'>
        <input
          ref={(el) => {
            if (el) inputRefs.current.set(cellKey, el)
            else inputRefs.current.delete(cellKey)
          }}
          type='text'
          value={displayValue}
          placeholder={column}
          onChange={handlers.onChange}
          onKeyDown={handleKeyDown}
          onScroll={handleScroll}
          onDrop={handlers.onDrop}
          onDragOver={handlers.onDragOver}
          onFocus={(e) => {
            setIsFocused(true)
            handlers.onFocus(e)
          }}
          onBlur={() => setIsFocused(false)}
          disabled={isPreview || disabled}
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck='false'
          className='w-full bg-transparent px-2.5 py-2 text-sm text-transparent leading-[21px] caret-[var(--text-primary)] outline-none [letter-spacing:inherit] placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-50'
        />
        <div
          ref={(el) => {
            if (el) overlayRefs.current.set(cellKey, el)
            else overlayRefs.current.delete(cellKey)
          }}
          data-overlay={cellKey}
          className='scrollbar-hide pointer-events-none absolute top-0 right-[10px] bottom-0 left-[10px] overflow-x-auto overflow-y-hidden bg-transparent'
        >
          <div className='whitespace-pre py-2 text-[var(--text-primary)] text-sm leading-[21px]'>
            {shouldMask
              ? displayValue
              : formatDisplayText(cellValue, {
                  accessiblePrefixes,
                  highlightAll: !accessiblePrefixes,
                  workflowSearchHighlight,
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

export function Table({
  blockId,
  subBlockId,
  columns,
  password = false,
  isPreview = false,
  previewValue,
  disabled = false,
}: TableProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [storeValue, setStoreValue] = useSubBlockValue<WorkflowTableRow[]>(blockId, subBlockId)
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

  // Create refs for input and overlay elements
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map())
  const overlayRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Memoized template for empty cells for current columns
  const emptyCellsTemplate = useMemo(
    () => Object.fromEntries(columns.map((col) => [col, ''])),
    [columns]
  )

  /**
   * Initialize the table with a default empty row when the component mounts
   * and when the current store value is missing or empty.
   */
  useEffect(() => {
    if (!isPreview && !disabled && (!Array.isArray(storeValue) || storeValue.length === 0)) {
      const initialRow: WorkflowTableRow = {
        id: generateId(),
        cells: { ...emptyCellsTemplate },
      }
      setStoreValue([initialRow])
    }
  }, [isPreview, disabled, storeValue, setStoreValue, emptyCellsTemplate])

  // Ensure value is properly typed and initialized
  const rows = useMemo(() => {
    if (!Array.isArray(value) || value.length === 0) {
      return [
        {
          id: generateId(),
          cells: { ...emptyCellsTemplate },
        },
      ]
    }

    // Validate and normalize each row without in-place mutation
    const validatedRows = value.map((row) => {
      const hasValidCells = row?.cells && typeof row.cells === 'object'
      if (!hasValidCells) {
        logger.warn('Fixing malformed table row:', row)
      }

      const normalizedCells = {
        ...emptyCellsTemplate,
        ...(hasValidCells ? row.cells : {}),
      }

      return {
        id: row?.id ?? generateId(),
        cells: normalizedCells,
      }
    })

    return validatedRows as WorkflowTableRow[]
  }, [value, emptyCellsTemplate])

  // Helper to update a cell value
  const updateCellValue = (rowIndex: number, column: string, newValue: string) => {
    if (isPreview || disabled) return

    const updatedRows = [...rows].map((row, idx) => {
      if (idx === rowIndex) {
        const hasValidCells = row.cells && typeof row.cells === 'object'
        const baseCells = hasValidCells ? row.cells : { ...emptyCellsTemplate }
        if (!hasValidCells) logger.warn('Fixing malformed row cells during cell change:', row)

        return {
          ...row,
          cells: { ...baseCells, [column]: newValue },
        }
      }
      return row
    })

    if (rowIndex === rows.length - 1 && newValue !== '') {
      updatedRows.push({
        id: generateId(),
        cells: { ...emptyCellsTemplate },
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
      <tr className='border-[var(--border-1)] border-b bg-transparent'>
        {columns.map((column, index) => {
          const workflowSearchHighlight = getWorkflowSearchLabelHighlight({
            activeSearchTarget,
            blockId,
            subBlockId,
            valuePath: ['columns', index],
            label: column,
          })
          return (
            <th
              key={column}
              className={cn(
                'bg-transparent px-2.5 py-[5px] text-left text-[var(--text-tertiary)] text-sm',
                index < columns.length - 1 && 'border-[var(--border-1)] border-r'
              )}
            >
              {formatDisplayText(column, { workflowSearchHighlight })}
            </th>
          )
        })}
      </tr>
    </thead>
  )

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
          <Trash className='size-[14px]' />
        </Button>
      </td>
    )

  return (
    <div className='relative'>
      <div className='overflow-visible rounded-sm border border-[var(--border-1)] bg-[var(--surface-2)] dark:bg-[var(--code-bg)]'>
        <table className='w-full bg-transparent'>
          {renderHeader()}
          <tbody className='bg-transparent'>
            {rows.map((row, rowIndex) => (
              <tr
                key={row.id}
                className='group relative border-[var(--border-1)] border-t bg-transparent'
              >
                {columns.map((column, cellIndex) => (
                  <TableCell
                    key={`${row.id}-${column}`}
                    row={row}
                    rowIndex={rowIndex}
                    column={column}
                    cellIndex={cellIndex}
                    columnsCount={columns.length}
                    password={password && cellIndex > 0}
                    isPreview={isPreview}
                    disabled={disabled}
                    blockId={blockId}
                    inputController={inputController}
                    updateCellValue={updateCellValue}
                    inputRefs={inputRefs}
                    overlayRefs={overlayRefs}
                    accessiblePrefixes={accessiblePrefixes}
                    workspaceId={workspaceId}
                    subBlockId={subBlockId}
                  />
                ))}
                {renderDeleteButton(rowIndex)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
