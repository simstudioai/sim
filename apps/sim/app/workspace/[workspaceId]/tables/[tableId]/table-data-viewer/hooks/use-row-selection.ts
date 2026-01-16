/**
 * Hook for managing row selection state.
 */

import { useCallback, useEffect, useState } from 'react'
import type { TableRow } from '@/lib/table'

interface UseRowSelectionReturn {
  selectedRows: Set<string>
  handleSelectAll: () => void
  handleSelectRow: (rowId: string) => void
  clearSelection: () => void
}

/**
 * Manages row selection state and provides selection handlers.
 *
 * @param rows - The current rows to select from
 * @returns Selection state and handlers
 */
export function useRowSelection(rows: TableRow[]): UseRowSelectionReturn {
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())

  /**
   * Filter out selected rows that are no longer in the current row set.
   * This handles pagination, filtering, and data refresh scenarios.
   */
  useEffect(() => {
    setSelectedRows((prev) => {
      if (prev.size === 0) return prev

      const currentRowIds = new Set(rows.map((r) => r.id))
      const filtered = new Set([...prev].filter((id) => currentRowIds.has(id)))

      // Only update state if something was actually filtered out
      return filtered.size !== prev.size ? filtered : prev
    })
  }, [rows])

  /**
   * Toggles selection of all visible rows.
   */
  const handleSelectAll = useCallback(() => {
    if (selectedRows.size === rows.length) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(rows.map((r) => r.id)))
    }
  }, [rows, selectedRows.size])

  /**
   * Toggles selection of a single row.
   */
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

  /**
   * Clears all selections.
   */
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
