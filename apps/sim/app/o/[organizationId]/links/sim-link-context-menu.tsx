'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { ArrowUpRight, Duplicate, Pencil, Trash } from '@sim/emcn/icons'

interface SimLinkContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onOpen: () => void
  onCopyLink: () => void
  /** Present only when the viewer may edit the link. */
  onEdit?: () => void
  /** Present only when the viewer may delete the link. */
  onDelete?: () => void
}

/** Row actions for one Sim link, anchored where the row was right-clicked. */
export function SimLinkContextMenu({
  isOpen,
  position,
  onClose,
  onOpen,
  onCopyLink,
  onEdit,
  onDelete,
}: SimLinkContextMenuProps) {
  return (
    <DropdownMenu open={isOpen} onOpenChange={(open) => !open && onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <div
          className='pointer-events-none fixed size-px'
          style={{ left: `${position.x}px`, top: `${position.y}px` }}
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
        <DropdownMenuItem onSelect={onOpen}>
          <ArrowUpRight />
          Open
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCopyLink}>
          <Duplicate />
          Copy link
        </DropdownMenuItem>
        {onEdit && (
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil />
            Edit
          </DropdownMenuItem>
        )}
        {onDelete && <DropdownMenuSeparator />}
        {onDelete && (
          <DropdownMenuItem onSelect={onDelete}>
            <Trash />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
