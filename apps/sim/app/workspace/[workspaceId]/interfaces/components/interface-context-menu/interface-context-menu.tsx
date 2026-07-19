'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { Duplicate, Pencil, Trash } from '@sim/emcn/icons'

interface InterfaceContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onRename: () => void
  onCopyId: () => void
  onDelete: () => void
  disableRename?: boolean
  disableDelete?: boolean
}

/**
 * Right-click menu for a single interface row. `Copy ID` is first-class here
 * because the Sim agent addresses interfaces by id (`user_interface`), not by
 * name or VFS path.
 */
export function InterfaceContextMenu({
  isOpen,
  position,
  onClose,
  onRename,
  onCopyId,
  onDelete,
  disableRename = false,
  disableDelete = false,
}: InterfaceContextMenuProps) {
  return (
    <DropdownMenu open={isOpen} onOpenChange={(open) => !open && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <div
          style={{
            position: 'fixed',
            left: `${position.x}px`,
            top: `${position.y}px`,
            width: '1px',
            height: '1px',
            pointerEvents: 'none',
          }}
          tabIndex={-1}
          aria-hidden
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        side='bottom'
        sideOffset={4}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuItem disabled={disableRename} onSelect={onRename}>
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCopyId}>
          <Duplicate />
          Copy ID
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={disableDelete} onSelect={onDelete}>
          <Trash />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
