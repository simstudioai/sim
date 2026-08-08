import { useCallback, useState } from 'react'
import type { TableRow } from '@/lib/table'
import type { ContextMenuState } from '../types'

interface UseContextMenuReturn {
  contextMenu: ContextMenuState
  handleRowContextMenu: (e: React.MouseEvent, row: TableRow, columnName?: string | null) => void
  handleEmptyCellContextMenu: (
    e: React.MouseEvent,
    rowIndex: number,
    columnName: string | null
  ) => void
  closeContextMenu: () => void
}

export function useContextMenu(): UseContextMenuReturn {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    position: { x: 0, y: 0 },
    row: null,
    rowIndex: null,
    columnName: null,
  })

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, row: TableRow, columnName?: string | null) => {
      e.preventDefault()
      e.stopPropagation()
      setContextMenu({
        isOpen: true,
        position: { x: e.clientX, y: e.clientY },
        row,
        rowIndex: row.position,
        columnName: columnName ?? null,
      })
    },
    []
  )

  const handleEmptyCellContextMenu = useCallback(
    (e: React.MouseEvent, rowIndex: number, columnName: string | null) => {
      e.preventDefault()
      e.stopPropagation()
      setContextMenu({
        isOpen: true,
        position: { x: e.clientX, y: e.clientY },
        row: null,
        rowIndex,
        columnName,
      })
    },
    []
  )

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, isOpen: false }))
  }, [])

  return {
    contextMenu,
    handleRowContextMenu,
    handleEmptyCellContextMenu,
    closeContextMenu,
  }
}
