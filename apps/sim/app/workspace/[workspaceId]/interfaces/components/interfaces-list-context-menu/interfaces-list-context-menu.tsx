'use client'

import { DropdownMenuItem } from '@sim/emcn'
import { Plus } from '@sim/emcn/icons'
import { AnchoredContextMenu } from '@/components/anchored-context-menu'

interface InterfacesListContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onCreateInterface: () => void
  disableCreate?: boolean
}

/**
 * Right-click menu for the empty area of the Interfaces list.
 */
export function InterfacesListContextMenu({
  isOpen,
  position,
  onClose,
  onCreateInterface,
  disableCreate = false,
}: InterfacesListContextMenuProps) {
  return (
    <AnchoredContextMenu isOpen={isOpen} position={position} onClose={onClose}>
      <DropdownMenuItem disabled={disableCreate} onSelect={onCreateInterface}>
        <Plus />
        Create interface
      </DropdownMenuItem>
    </AnchoredContextMenu>
  )
}
