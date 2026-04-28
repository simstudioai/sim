'use client'

import { forwardRef, memo, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { cn } from '@/lib/core/utils/cn'

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
    <div className='overflow-x-auto rounded-md border border-[var(--border)]'>
      <table className='w-full border-collapse text-[13px]'>
        <thead className='bg-[var(--surface-2)]'>
          <tr>
            {headers.map((header, i) => (
              <th
                key={i}
                className={cn(
                  'whitespace-nowrap px-3 py-2 text-left font-semibold text-[12px] text-[var(--text-primary)]',
                  editConfig && 'cursor-pointer select-none hover:bg-[var(--surface-3)]'
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
                    className='w-full min-w-[60px] bg-transparent font-semibold text-[12px] text-[var(--text-primary)] outline-none ring-1 ring-[var(--brand-secondary)] ring-inset'
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
            <tr key={ri} className='border-[var(--border)] border-t'>
              {headers.map((_, ci) => (
                <td
                  key={ci}
                  className={cn(
                    'whitespace-nowrap px-3 py-2 text-[var(--text-secondary)]',
                    editConfig && 'cursor-pointer select-none hover:bg-[var(--surface-2)]'
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
                      className='w-full min-w-[60px] bg-transparent text-[13px] text-[var(--text-secondary)] outline-none ring-1 ring-[var(--brand-secondary)] ring-inset'
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
