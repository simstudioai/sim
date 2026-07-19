'use client'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'

interface InterfacesListContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onCreateInterface: () => void
  disableCreate?: boolean
}

/**
 * Right-click menu for the empty area of the Interfaces list. Anchored to the
 * pointer through a zero-size fixed trigger, mirroring the tables list menu.
 */
export function InterfacesListContextMenu({
  isOpen,
  position,
  onClose,
  onCreateInterface,
  disableCreate = false,
}: InterfacesListContextMenuProps) {
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
        <DropdownMenuItem disabled={disableCreate} onSelect={onCreateInterface}>
          <Plus />
          Create interface
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
