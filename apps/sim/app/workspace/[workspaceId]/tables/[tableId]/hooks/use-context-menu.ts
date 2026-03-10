import { useCallback, useState } from 'react'
import type { TableRow } from '@/lib/table'
import type { ContextMenuState } from '../types'

interface UseContextMenuReturn {
  contextMenu: ContextMenuState
  handleRowContextMenu: (e: React.MouseEvent, row: TableRow, columnName?: string | null) => void
  closeContextMenu: () => void
}

export function useContextMenu(): UseContextMenuReturn {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    position: { x: 0, y: 0 },
    row: null,
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
        columnName: columnName ?? null,
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
    closeContextMenu,
  }
}
