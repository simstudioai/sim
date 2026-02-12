import { useCallback, useState } from 'react'
import type { TableRow } from '@/lib/table'
import type { ContextMenuState } from '../lib/types'

interface UseContextMenuReturn {
  contextMenu: ContextMenuState
  handleRowContextMenu: (e: React.MouseEvent, row: TableRow) => void
  closeContextMenu: () => void
}

export function useContextMenu(): UseContextMenuReturn {
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    position: { x: 0, y: 0 },
    row: null,
  })

  const handleRowContextMenu = useCallback((e: React.MouseEvent, row: TableRow) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({
      isOpen: true,
      position: { x: e.clientX, y: e.clientY },
      row,
    })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu((prev) => ({ ...prev, isOpen: false }))
  }, [])

  return {
    contextMenu,
    handleRowContextMenu,
    closeContextMenu,
  }
}
