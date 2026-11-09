'use client'

import { type KeyboardEvent, useEffect, useMemo, useRef } from 'react'
import { IconButton } from '@sim/emcn/button'
import { useActiveSearchTarget } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/active-search-target/active-search-target'
import { formatDisplayText } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/formatted-text'
import {
  getActiveWorkflowSearchHighlight,
  getWorkflowSearchLabelHighlight,
} from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/formatted-text/search-highlight'
import { ReferenceField } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/reference-field/reference-field'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/table/table.module.css'
import {
  useAccessibleReferencePrefixes,
  useSubBlockInput,
  useSubBlockValue,
} from '@/platform/lib/data/workflow-editor'
import {
  createEmptyTableRow,
  normalizeTableRows,
  tableCellText,
  type WorkflowTableRow,
} from '@/platform/lib/data/workflow-editor/builders'

interface TableProps {
  blockId: string
  subBlockId: string
  columns: string[]
  /**
   * Conceals the value columns except while a cell is focused. The first column is the key half of
   * a key/value secrets table and stays legible, so the rows can still be told apart.
   */
  password?: boolean
  isPreview?: boolean
  previewValue?: unknown
  disabled?: boolean
}

const cellKey = (rowIndex: number, column: string) => `${rowIndex}-${column}`

/**
 * A key/value style table: one reference-aware field per configured column, a new blank row as soon
 * as the last row is typed into, Enter moving down a column, and row removal while more than one
 * row remains. Every edit writes the whole row array.
 */
export function Table({
  blockId,
  subBlockId,
  columns,
  password = false,
  isPreview = false,
  previewValue,
  disabled = false,
}: TableProps) {
  const inputElements = useRef<Map<string, HTMLInputElement> | null>(null)
  inputElements.current ??= new Map()
  const activeSearchTarget = useActiveSearchTarget()
  const [storeValue, setStoreValue] = useSubBlockValue<WorkflowTableRow[]>(blockId, subBlockId)
  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)
  const controller = useSubBlockInput({
    blockId,
    subBlockId,
    config: { id: subBlockId, type: 'table', connectionDroppable: true },
    isPreview,
    disabled,
  })

  const readOnly = isPreview || disabled
  const value: unknown = isPreview ? previewValue : storeValue
  const rows = useMemo(() => normalizeTableRows(value, columns), [value, columns])

  useEffect(() => {
    if (!isPreview && !disabled && (!Array.isArray(storeValue) || storeValue.length === 0)) {
      setStoreValue([createEmptyTableRow(columns)])
    }
  }, [isPreview, disabled, storeValue, setStoreValue, columns])

  const updateCell = (rowIndex: number, column: string, next: string) => {
    if (readOnly) return
    const updated = rows.map((row, index) =>
      index === rowIndex ? { ...row, cells: { ...row.cells, [column]: next } } : row
    )
    if (rowIndex === rows.length - 1 && next !== '') updated.push(createEmptyTableRow(columns))
    setStoreValue(updated)
  }

  const deleteRow = (rowIndex: number) => {
    if (readOnly || rows.length === 1) return
    setStoreValue(rows.filter((_, index) => index !== rowIndex))
  }

  /**
   * Enter advances to the same column in the next row, spreadsheet-style; that row already exists,
   * since one is appended the moment the last row is typed into. Focusing an empty cell opens its
   * reference picker, so the destination's picker is closed again: a follow-up Enter continues down
   * the column instead of inserting a reference. `isConnected` skips a position-keyed element a
   * deleted row left behind.
   */
  const moveDown = (event: KeyboardEvent<HTMLInputElement>, rowIndex: number, column: string) => {
    const nextKey = cellKey(rowIndex + 1, column)
    const next = inputElements.current?.get(nextKey)
    if (!next?.isConnected) return
    event.preventDefault()
    next.focus()
    controller.fieldHelpers.hideFieldDropdowns(nextKey)
  }

  return (
    <div className={styles.table}>
      <div className={styles.row}>
        {columns.map((column, index) => (
          <span key={column} className={styles.heading} data-type='T052'>
            {formatDisplayText(column, {
              workflowSearchHighlight: getWorkflowSearchLabelHighlight({
                activeSearchTarget,
                blockId,
                subBlockId,
                valuePath: ['columns', index],
                label: column,
              }),
            })}
          </span>
        ))}
        {!readOnly && <span className={styles.action} />}
      </div>
      {rows.map((row, rowIndex) => (
        <div key={row.id} className={styles.row}>
          {columns.map((column, cellIndex) => {
            const key = cellKey(rowIndex, column)
            return (
              <div key={column} className={styles.cell}>
                <ReferenceField
                  controller={controller}
                  fieldKey={key}
                  blockId={blockId}
                  value={tableCellText(row, column)}
                  onChange={(next) => updateCell(rowIndex, column, next)}
                  label={`${column}, row ${rowIndex + 1}`}
                  placeholder={column}
                  disabled={readOnly}
                  accessiblePrefixes={accessiblePrefixes}
                  searchHighlight={getActiveWorkflowSearchHighlight({
                    activeSearchTarget,
                    blockId,
                    subBlockId,
                    valuePath: [rowIndex, 'cells', column],
                  })}
                  secrets
                  password={password && cellIndex > 0}
                  onEnter={(event) => moveDown(event, rowIndex, column)}
                  fieldRef={(element) => {
                    if (element instanceof HTMLInputElement)
                      inputElements.current?.set(key, element)
                    else inputElements.current?.delete(key)
                  }}
                />
              </div>
            )
          })}
          {!readOnly && (
            <span className={styles.action}>
              {rows.length > 1 && (
                <IconButton
                  label={`Delete row ${rowIndex + 1}`}
                  icon='I105'
                  size='row'
                  tooltip
                  onClick={() => deleteRow(rowIndex)}
                />
              )}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
