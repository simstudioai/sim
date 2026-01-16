import { useCallback, useEffect, useState } from 'react'
import type { TableRow } from '@/lib/table'

interface UseRowSelectionReturn {
  selectedRows: Set<string>
  handleSelectAll: () => void
  handleSelectRow: (rowId: string) => void
  clearSelection: () => void
}

export function useRowSelection(rows: TableRow[]): UseRowSelectionReturn {
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())

  useEffect(() => {
    setSelectedRows((prev) => {
      if (prev.size === 0) return prev

      const currentRowIds = new Set(rows.map((r) => r.id))
      const filtered = new Set([...prev].filter((id) => currentRowIds.has(id)))

      // Only update state if something was actually filtered out
      return filtered.size !== prev.size ? filtered : prev
    })
  }, [rows])

  const handleSelectAll = useCallback(() => {
    if (selectedRows.size === rows.length) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(rows.map((r) => r.id)))
    }
  }, [rows, selectedRows.size])

  const handleSelectRow = useCallback((rowId: string) => {
    setSelectedRows((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(rowId)) {
        newSet.delete(rowId)
      } else {
        newSet.add(rowId)
      }
      return newSet
    })
  }, [])

  const clearSelection = useCallback(() => {
    setSelectedRows(new Set())
  }, [])

  return {
    selectedRows,
    handleSelectAll,
    handleSelectRow,
    clearSelection,
  }
}
