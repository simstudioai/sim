/**
 * Hook for managing row selection state.
 *
 * @module tables/[tableId]/table-data-viewer/hooks/use-row-selection
 */

import { useCallback, useState } from 'react'
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
