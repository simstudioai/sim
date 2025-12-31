import { useCallback, useEffect, useRef, useState } from 'react'
import type { Node } from 'reactflow'
import type { BlockState } from '@/stores/workflows/workflow/types'
import type { ContextMenuBlockInfo, ContextMenuPosition } from '../components/context-menu/types'

type MenuType = 'block' | 'pane' | null

interface UseCanvasContextMenuProps {
  /** Current blocks from workflow store */
  blocks: Record<string, BlockState>
  /** Function to get nodes from ReactFlow */
  getNodes: () => Node[]
}

/**
 * Hook for managing workflow canvas context menus.
 *
 * Handles:
 * - Right-click event handling for blocks and pane
 * - Menu open/close state for both menu types
 * - Click-outside detection to close menus
 * - Selected block info extraction for multi-selection support
 */
export function useCanvasContextMenu({ blocks, getNodes }: UseCanvasContextMenuProps) {
  const [activeMenu, setActiveMenu] = useState<MenuType>(null)
  const [position, setPosition] = useState<ContextMenuPosition>({ x: 0, y: 0 })
  const [selectedBlocks, setSelectedBlocks] = useState<ContextMenuBlockInfo[]>([])

  const menuRef = useRef<HTMLDivElement>(null)

  /** Converts nodes to block info for context menu */
  const nodesToBlockInfos = useCallback(
    (nodes: Node[]): ContextMenuBlockInfo[] =>
      nodes.map((n) => {
        const block = blocks[n.id]
        const parentId = block?.data?.parentId
        const parentType = parentId ? blocks[parentId]?.type : undefined
        return {
          id: n.id,
          type: block?.type || '',
          enabled: block?.enabled ?? true,
          horizontalHandles: block?.horizontalHandles ?? false,
          parentId,
          parentType,
        }
      }),
    [blocks]
  )

  /**
   * Handle right-click on a node (block)
   */
  const handleNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault()
      event.stopPropagation()

      const selectedNodes = getNodes().filter((n) => n.selected)
      const nodesToUse = selectedNodes.some((n) => n.id === node.id) ? selectedNodes : [node]

      setPosition({ x: event.clientX, y: event.clientY })
      setSelectedBlocks(nodesToBlockInfos(nodesToUse))
      setActiveMenu('block')
    },
    [getNodes, nodesToBlockInfos]
  )

  /**
   * Handle right-click on the pane (empty canvas area)
   */
  const handlePaneContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()

    setPosition({ x: event.clientX, y: event.clientY })
    setSelectedBlocks([])
    setActiveMenu('pane')
  }, [])

  /**
   * Handle right-click on a selection (multiple selected nodes)
   */
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

  /**
   * Close the active context menu
   */
  const closeMenu = useCallback(() => {
    setActiveMenu(null)
  }, [])

  /**
   * Handle clicks outside the menu to close it
   */
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

  /**
   * Close menu on scroll or zoom to prevent menu from being positioned incorrectly
   */
  useEffect(() => {
    if (!activeMenu) return

    const handleScroll = () => closeMenu()

    window.addEventListener('wheel', handleScroll, { passive: true })

    return () => {
      window.removeEventListener('wheel', handleScroll)
    }
  }, [activeMenu, closeMenu])

  return {
    /** Whether the block context menu is open */
    isBlockMenuOpen: activeMenu === 'block',
    /** Whether the pane context menu is open */
    isPaneMenuOpen: activeMenu === 'pane',
    /** Position for the context menu */
    position,
    /** Ref for the menu element */
    menuRef,
    /** Selected blocks info for multi-selection actions */
    selectedBlocks,
    /** Handler for ReactFlow onNodeContextMenu */
    handleNodeContextMenu,
    /** Handler for ReactFlow onPaneContextMenu */
    handlePaneContextMenu,
    /** Handler for ReactFlow onSelectionContextMenu */
    handleSelectionContextMenu,
    /** Close the active context menu */
    closeMenu,
  }
}
