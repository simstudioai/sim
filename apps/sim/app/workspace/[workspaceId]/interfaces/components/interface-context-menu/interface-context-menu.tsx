'use client'

import { DropdownMenuItem } from '@sim/emcn'
import { Duplicate, Pencil, Send, Trash } from '@sim/emcn/icons'
import { AnchoredContextMenu } from '@/components/anchored-context-menu'

interface InterfaceContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onRename: () => void
  onShare: () => void
  onCopyId: () => void
  onDelete: () => void
  disableRename?: boolean
  disableShare?: boolean
  disableDelete?: boolean
}

/**
 * Right-click menu for a single interface row, in the canonical resource-menu
 * item order: Rename, Share, utilities, Delete. `Copy ID` is first-class here
 * because the Sim agent addresses interfaces by id (`user_interface`), not by
 * name or VFS path.
 */
export function InterfaceContextMenu({
  isOpen,
  position,
  onClose,
  onRename,
  onShare,
  onCopyId,
  onDelete,
  disableRename = false,
  disableShare = false,
  disableDelete = false,
}: InterfaceContextMenuProps) {
  return (
    <AnchoredContextMenu isOpen={isOpen} position={position} onClose={onClose}>
      <DropdownMenuItem disabled={disableRename} onSelect={onRename}>
        <Pencil />
        Rename
      </DropdownMenuItem>
      <DropdownMenuItem disabled={disableShare} onSelect={onShare}>
        <Send />
        Share
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onCopyId}>
        <Duplicate />
        Copy ID
      </DropdownMenuItem>
      <DropdownMenuItem disabled={disableDelete} onSelect={onDelete}>
        <Trash />
        Delete
      </DropdownMenuItem>
    </AnchoredContextMenu>
  )
}
