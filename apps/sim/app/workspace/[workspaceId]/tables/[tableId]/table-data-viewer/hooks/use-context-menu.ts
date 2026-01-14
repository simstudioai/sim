/**
 * Hook for managing context menu state.
 *
 * @module tables/[tableId]/table-data-viewer/hooks/use-context-menu
 */

import { useCallback, useState } from 'react'
import type { ContextMenuState, TableRowData } from '../types'

interface UseContextMenuReturn {
  contextMenu: ContextMenuState
  handleRowContextMenu: (e: React.MouseEvent, row: TableRowData) => void
  closeContextMenu: () => void
}

/**
 * Manages context menu state for row interactions.
 *
 * @returns Context menu state and handlers
 */
export function useContextMenu(): UseContextMenuReturn {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    position: { x: 0, y: 0 },
    row: null,
  })

  /**
   * Opens the context menu for a row.
   */
  const handleRowContextMenu = useCallback((e: React.MouseEvent, row: TableRowData) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      row,
    })
  }, [])

  /**
   * Closes the context menu.
   */
  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, isOpen: false }))
  }, [])

  return {
    contextMenu,
    handleRowContextMenu,
    closeContextMenu,
  }
}
