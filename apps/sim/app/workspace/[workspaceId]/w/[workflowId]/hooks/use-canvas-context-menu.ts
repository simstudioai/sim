import { useCallback, useEffect, useRef, useState } from 'react'
import type { Node } from 'reactflow'
import type { BlockState } from '@/stores/workflows/workflow/types'
import type { BlockInfo } from '../components/block-menu'

type MenuType = 'block' | 'pane' | null

interface UseCanvasContextMenuProps {
  blocks: Record<string, BlockState>
  getNodes: () => Node[]
  setNodes: (updater: (nodes: Node[]) => Node[]) => void
}

/**
 * Hook for managing workflow canvas context menus.
 *
 * Handles right-click events on nodes, pane, and selections with proper multi-select behavior.
 *
 * @param props - Hook configuration
 * @returns Context menu state and handlers
 */
export function useCanvasContextMenu({ blocks, getNodes, setNodes }: UseCanvasContextMenuProps) {
  const [activeMenu, setActiveMenu] = useState<MenuType>(null)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [selectedBlocks, setSelectedBlocks] = useState<BlockInfo[]>([])

  const menuRef = useRef<HTMLDivElement>(null)

  const nodesToBlockInfos = useCallback(
    (nodes: Node[]): BlockInfo[] =>
      nodes.map((n) => {
        const block = blocks[n.id]
        const parentId = block?.data?.parentId
        const parentBlock = parentId ? blocks[parentId] : undefined
        const parentType = parentBlock?.type
        return {
          id: n.id,
          type: block?.type || '',
          enabled: block?.enabled ?? true,
          horizontalHandles: block?.horizontalHandles ?? false,
          parentId,
          parentType,
          locked: block?.locked ?? false,
          isParentLocked: parentBlock?.locked ?? false,
          isParentDisabled: parentBlock ? !parentBlock.enabled : false,
        }
      }),
    [blocks]
  )

  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault()
      event.stopPropagation()

      const isMultiSelect = event.shiftKey || event.metaKey || event.ctrlKey
      const currentSelectedNodes = getNodes().filter((n) => n.selected)
      const isClickedNodeSelected = currentSelectedNodes.some((n) => n.id === node.id)

      let nodesToUse: Node[]
      if (isClickedNodeSelected) {
        nodesToUse = currentSelectedNodes
      } else if (isMultiSelect) {
        nodesToUse = [...currentSelectedNodes, node]
        setNodes((nodes) =>
          nodes.map((n) => ({
            ...n,
            selected: n.id === node.id ? true : n.selected,
          }))
        )
      } else {
        nodesToUse = [node]
        setNodes((nodes) =>
          nodes.map((n) => ({
            ...n,
            selected: n.id === node.id,
          }))
        )
      }

      setPosition({ x: event.clientX, y: event.clientY })
      setSelectedBlocks(nodesToBlockInfos(nodesToUse))
      setActiveMenu('block')
    },
    [getNodes, nodesToBlockInfos, setNodes]
  )

  const handlePaneContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()

    setPosition({ x: event.clientX, y: event.clientY })
    setSelectedBlocks([])
    setActiveMenu('pane')
  }, [])

  const handleSelectionContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()

      const selectedNodes = getNodes().filter((n) => n.selected)

      setPosition({ x: event.clientX, y: event.clientY })
      setSelectedBlocks(nodesToBlockInfos(selectedNodes))
      setActiveMenu('block')
    },
    [getNodes, nodesToBlockInfos]
  )

  const closeMenu = useCallback(() => {
    setActiveMenu(null)
  }, [])

  useEffect(() => {
    if (!activeMenu) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as globalThis.Node)) {
        closeMenu()
      }
    }

    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timeoutId)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [activeMenu, closeMenu])

  useEffect(() => {
    if (!activeMenu) return

    const handleScroll = () => closeMenu()

    window.addEventListener('wheel', handleScroll, { passive: true })

    return () => {
      window.removeEventListener('wheel', handleScroll)
    }
  }, [activeMenu, closeMenu])

  return {
    isBlockMenuOpen: activeMenu === 'block',
    isPaneMenuOpen: activeMenu === 'pane',
    position,
    menuRef,
    selectedBlocks,
    handleNodeContextMenu,
    handlePaneContextMenu,
    handleSelectionContextMenu,
    closeMenu,
  }
}
