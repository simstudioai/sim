import { useCallback, useMemo, useState } from 'react'
import type { TableRow } from '@/lib/table'

interface UseRowSelectionReturn {
  selectedRows: Set<string>
  handleSelectAll: () => void
  handleSelectRow: (rowId: string) => void
  clearSelection: () => void
}

export function useRowSelection(rows: TableRow[]): UseRowSelectionReturn {
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [prevRowsSignature, setPrevRowsSignature] = useState('')

  const currentRowIds = useMemo(() => new Set(rows.map((r) => r.id)), [rows])
  const rowsSignature = useMemo(() => rows.map((r) => r.id).join('|'), [rows])

  if (rowsSignature !== prevRowsSignature) {
    setPrevRowsSignature(rowsSignature)
    setSelectedRows((prev) => {
      if (prev.size === 0) return prev
      const filtered = new Set([...prev].filter((id) => currentRowIds.has(id)))
      return filtered.size !== prev.size ? filtered : prev
    })
  }

  const visibleSelectedRows = useMemo(
    () => new Set([...selectedRows].filter((id) => currentRowIds.has(id))),
    [selectedRows, currentRowIds]
  )

  const handleSelectAll = useCallback(() => {
    if (visibleSelectedRows.size === rows.length) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(rows.map((r) => r.id)))
    }
  }, [rows, visibleSelectedRows.size])

  const handleSelectRow = useCallback(
    (rowId: string) => {
      setSelectedRows((prev) => {
        const newSet = new Set([...prev].filter((id) => currentRowIds.has(id)))
        if (newSet.has(rowId)) {
          newSet.delete(rowId)
        } else {
          newSet.add(rowId)
        }
        return newSet
      })
    },
    [currentRowIds]
  )

  const clearSelection = useCallback(() => {
    setSelectedRows(new Set())
  }, [])

  return {
    selectedRows: visibleSelectedRows,
    handleSelectAll,
    handleSelectRow,
    clearSelection,
  }
}
