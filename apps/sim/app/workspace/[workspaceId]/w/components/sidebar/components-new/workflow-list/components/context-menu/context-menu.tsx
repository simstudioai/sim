'use client'

import { ArrowUp, Pencil, Plus } from 'lucide-react'
import { Popover, PopoverAnchor, PopoverContent, PopoverItem } from '@/components/emcn'
import { Copy, Trash } from '@/components/emcn/icons'

interface ContextMenuProps {
  /**
   * Whether the context menu is open
   */
  isOpen: boolean
  /**
   * Position of the context menu
   */
  position: { x: number; y: number }
  /**
   * Ref for the menu element
   */
  menuRef: React.RefObject<HTMLDivElement | null>
  /**
   * Callback when menu should close
   */
  onClose: () => void
  /**
   * Callback when rename is clicked
   */
  onRename?: () => void
  /**
   * Callback when create is clicked (for folders)
   */
  onCreate?: () => void
  /**
   * Callback when duplicate is clicked
   */
  onDuplicate?: () => void
  /**
   * Callback when export is clicked
   */
  onExport?: () => void
  /**
   * Callback when delete is clicked
   */
  onDelete: () => void
  /**
   * Whether to show the rename option (default: true)
   * Set to false when multiple items are selected
   */
  showRename?: boolean
  /**
   * Whether to show the create option (default: false)
   * Set to true for folders to create workflows inside
   */
  showCreate?: boolean
  /**
   * Whether to show the duplicate option (default: true)
   * Set to false for items that cannot be duplicated
   */
  showDuplicate?: boolean
  /**
   * Whether to show the export option (default: false)
   * Set to true for items that can be exported (like workspaces)
   */
  showExport?: boolean
}

/**
 * Context menu component for workflow, folder, and workspace items.
 * Displays context-appropriate options (rename, duplicate, export, delete) in a popover at the right-click position.
 *
 * @param props - Component props
 * @returns Context menu popover
 */
export function ContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onRename,
  onCreate,
  onDuplicate,
  onExport,
  onDelete,
  showRename = true,
  showCreate = false,
  showDuplicate = true,
  showExport = false,
}: ContextMenuProps) {
  return (
    <Popover open={isOpen} onOpenChange={onClose}>
      <PopoverAnchor
        style={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          width: '1px',
          height: '1px',
        }}
      />
      <PopoverContent ref={menuRef} align='start' side='bottom' sideOffset={4}>
        {showRename && onRename && (
          <PopoverItem
            onClick={() => {
              onRename()
              onClose()
            }}
          >
            <Pencil className='h-3 w-3' />
            <span>Rename</span>
          </PopoverItem>
        )}
        {showCreate && onCreate && (
          <PopoverItem
            onClick={() => {
              onCreate()
              onClose()
            }}
          >
            <Plus className='h-3 w-3' />
            <span>Create workflow</span>
          </PopoverItem>
        )}
        {showDuplicate && onDuplicate && (
          <PopoverItem
            onClick={() => {
              onDuplicate()
              onClose()
            }}
          >
            <Copy className='h-3 w-3' />
            <span>Duplicate</span>
          </PopoverItem>
        )}
        {showExport && onExport && (
          <PopoverItem
            onClick={() => {
              onExport()
              onClose()
            }}
          >
            <ArrowUp className='h-3 w-3' />
            <span>Export</span>
          </PopoverItem>
        )}
        <PopoverItem
          onClick={() => {
            onDelete()
            onClose()
          }}
        >
          <Trash className='h-3 w-3' />
          <span>Delete</span>
        </PopoverItem>
      </PopoverContent>
    </Popover>
  )
}
