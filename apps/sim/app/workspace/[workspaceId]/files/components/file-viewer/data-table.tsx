'use client'

import { forwardRef, memo, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import './document-table.css'

interface EditConfig {
  onCellChange: (row: number, col: number, value: string) => void
  onHeaderChange: (col: number, value: string) => void
}

interface DataTableProps {
  headers: string[]
  rows: string[][]
  editConfig?: EditConfig
}

export interface DataTableHandle {
  commitEdit: () => void
}

type EditingCell = { row: number; col: number } | null

/**
 * Tabular renderer for CSV and XLSX previews. Chrome (borders, padding, typography, header fill)
 * comes entirely from `document-table.css`, the definition shared with markdown tables in the rich
 * markdown editor — the only classes here are the optional edit affordances.
 *
 * Scrolling belongs to the caller's bounded container, which already scrolls vertically. A preview
 * table is wider than its frame, so an `overflow-x` of its own would put the horizontal scrollbar
 * at the foot of all {@link CSV_PREVIEW_MAX_ROWS} rows instead of at the bottom of the viewport.
 */
const DataTableBase = forwardRef<DataTableHandle, DataTableProps>(function DataTable(
  { headers, rows, editConfig },
  ref
) {
  const [editingCell, setEditingCell] = useState<EditingCell>(null)
  const [editValue, setEditValue] = useState('')

  const editStateRef = useRef({ editingCell, editValue, editConfig })
  editStateRef.current = { editingCell, editValue, editConfig }

  // Prevents double-commit if onBlur and imperative commitEdit fire concurrently
  const isCommittedRef = useRef(false)

  useImperativeHandle(
    ref,
    () => ({
      commitEdit: () => {
        if (isCommittedRef.current) return
        const { editingCell, editValue, editConfig } = editStateRef.current
        if (!editingCell || !editConfig) return
        isCommittedRef.current = true
        const { row, col } = editingCell
        if (row === -1) {
          editConfig.onHeaderChange(col, editValue)
        } else {
          editConfig.onCellChange(row, col, editValue)
        }
        setEditingCell(null)
      },
    }),
    []
  )

  const setInputRef = useCallback((node: HTMLInputElement | null) => {
    if (node) {
      node.focus()
      node.select()
    }
  }, [])

  const startEdit = (row: number, col: number, currentValue: string) => {
    if (!editConfig) return
    isCommittedRef.current = false
    setEditingCell({ row, col })
    setEditValue(currentValue)
  }

  const commitEdit = () => {
    if (isCommittedRef.current || !editingCell || !editConfig) return
    isCommittedRef.current = true
    const { row, col } = editingCell
    if (row === -1) {
      editConfig.onHeaderChange(col, editValue)
    } else {
      editConfig.onCellChange(row, col, editValue)
    }
    setEditingCell(null)
  }

  const cancelEdit = () => setEditingCell(null)

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      commitEdit()
    } else if (e.key === 'Escape') {
      cancelEdit()
    }
  }

  const isEditing = (row: number, col: number) =>
    editingCell?.row === row && editingCell?.col === col

  return (
    <div className='document-table'>
      <table>
        <thead>
          <tr>
            {headers.map((header, i) => (
              <th
                key={i}
                className={cn(
                  editConfig && 'cursor-pointer select-none hover:bg-[var(--surface-active)]'
                )}
                onClick={() => editConfig && startEdit(-1, i, String(header ?? ''))}
              >
                {isEditing(-1, i) ? (
                  <input
                    ref={setInputRef}
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={handleKeyDown}
                    className='w-full min-w-[60px] bg-transparent outline-hidden ring-1 ring-[var(--brand-secondary)] ring-inset'
                  />
                ) : (
                  String(header ?? '')
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {headers.map((_, ci) => (
                <td
                  key={ci}
                  className={cn(
                    editConfig && 'cursor-pointer select-none hover:bg-[var(--surface-active)]'
                  )}
                  onClick={() => editConfig && startEdit(ri, ci, String(row[ci] ?? ''))}
                >
                  {isEditing(ri, ci) ? (
                    <input
                      ref={setInputRef}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={commitEdit}
                      onKeyDown={handleKeyDown}
                      className='w-full min-w-[60px] bg-transparent outline-hidden ring-1 ring-[var(--brand-secondary)] ring-inset'
                    />
                  ) : (
                    String(row[ci] ?? '')
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
})

export const DataTable = memo(DataTableBase)
