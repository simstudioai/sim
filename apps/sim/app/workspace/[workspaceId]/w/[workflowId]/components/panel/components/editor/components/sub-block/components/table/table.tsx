import { useEffect, useMemo, useRef } from 'react'
import { Button, cn } from '@sim/emcn'
import { Trash } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { useParams } from 'next/navigation'
import { EnvVarDropdown } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/env-var-dropdown'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
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
  isPreview?: boolean
  previewValue?: WorkflowTableRow[] | null
  disabled?: boolean
  /**
   * Optional seed rows applied when a fresh block first mounts (store value
   * is missing/empty). Each entry's `cells` keys must match `columns` — any
   * missing columns fall back to `""`. Existing values are never overwritten.
   */
  defaultRows?: Array<{ cells: Record<string, string> }>
  /**
   * Optional async fetcher for seed rows — used when the block's default
   * rows come from a server-side source (e.g. deployer-configured env vars
   * read via an API route). Called once on first mount when the store is
   * empty. If the fetcher rejects or returns an empty array, falls back to
   * `defaultRows`, then to a single empty row. Same overwrite rules as
   * `defaultRows`: existing store values are never touched.
   */
  fetchDefaultRows?: () => Promise<Array<{ cells: Record<string, string> }>>
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
          }}
          type='text'
          value={cellValue}
          placeholder={column}
          onChange={handlers.onChange}
          onKeyDown={handlers.onKeyDown}
          onScroll={handleScroll}
          onDrop={handlers.onDrop}
          onDragOver={handlers.onDragOver}
          onFocus={handlers.onFocus}
          disabled={isPreview || disabled}
          autoComplete='off'
          autoCorrect='off'
          autoCapitalize='off'
          spellCheck='false'
          className='w-full bg-transparent px-2.5 py-2 font-medium text-sm text-transparent leading-[21px] caret-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed disabled:opacity-50'
        />
        <div
          ref={(el) => {
            if (el) overlayRefs.current.set(cellKey, el)
          }}
          data-overlay={cellKey}
          className='scrollbar-hide pointer-events-none absolute top-0 right-[10px] bottom-0 left-[10px] overflow-x-auto overflow-y-hidden bg-transparent'
        >
          <div className='whitespace-pre py-2 font-medium text-[var(--text-primary)] text-sm leading-[21px]'>
            {formatDisplayText(cellValue, {
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
  isPreview = false,
  previewValue,
  disabled = false,
  defaultRows,
  fetchDefaultRows,
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
   * Initialize the table when the component mounts and the store value is
   * missing/empty. Precedence:
   *   1. `fetchDefaultRows` (async) — used when defaults live server-side
   *      (e.g. deployer env-var read via an API route).
   *   2. `defaultRows` (sync) — static seeds declared on the block config.
   *   3. Single empty row — the pre-existing behavior.
   * Existing store values are never touched.
   */
  useEffect(() => {
    if (isPreview || disabled) return
    if (Array.isArray(storeValue) && storeValue.length > 0) return
    let cancelled = false
    const seedWith = (rows: Array<{ cells: Record<string, string> }> | undefined) => {
      if (cancelled) return
      const seedRows: WorkflowTableRow[] =
        Array.isArray(rows) && rows.length > 0
          ? rows.map((row) => ({
              id: generateId(),
              cells: { ...emptyCellsTemplate, ...(row.cells ?? {}) },
            }))
          : [{ id: generateId(), cells: { ...emptyCellsTemplate } }]
      setStoreValue(seedRows)
    }
    if (fetchDefaultRows) {
      fetchDefaultRows()
        .then((rows) => seedWith(rows.length > 0 ? rows : defaultRows))
        .catch(() => seedWith(defaultRows))
    } else {
      seedWith(defaultRows)
    }
    return () => {
      cancelled = true
    }
  }, [
    isPreview,
    disabled,
    storeValue,
    setStoreValue,
    emptyCellsTemplate,
    defaultRows,
    fetchDefaultRows,
  ])

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
                'bg-transparent px-2.5 py-[5px] text-left font-medium text-[var(--text-tertiary)] text-sm',
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
