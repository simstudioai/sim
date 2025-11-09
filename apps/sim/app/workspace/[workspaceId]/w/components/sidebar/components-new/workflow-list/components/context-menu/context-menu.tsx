'use client'

import { Pencil } from 'lucide-react'
import { Popover, PopoverAnchor, PopoverContent, PopoverItem } from '@/components/emcn'
import { Trash } from '@/components/emcn/icons'

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
  onRename: () => void
  /**
   * Callback when delete is clicked
   */
  onDelete: () => void
}

/**
 * Reusable context menu component for workflow and folder items.
 * Displays rename and delete options in a popover at the right-click position.
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
  onDelete,
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
        <PopoverItem
          onClick={() => {
            onRename()
            onClose()
          }}
        >
          <Pencil className='h-3 w-3' />
          <span>Rename</span>
        </PopoverItem>
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
