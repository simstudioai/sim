'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { Copy, Trash } from '@/components/emcn/icons'

interface TableContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onCopyId?: () => void
  onDelete?: () => void
  disableDelete?: boolean
}

export function TableContextMenu({
  isOpen,
  position,
  onClose,
  onCopyId,
  onDelete,
  disableDelete = false,
}: TableContextMenuProps) {
  return (
    <DropdownMenu open={isOpen} onOpenChange={(open) => !open && onClose()}>
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
      <DropdownMenuContent align='start' side='bottom' sideOffset={4}>
        {onCopyId && (
          <DropdownMenuItem onSelect={onCopyId}>
            <Copy />
            Copy ID
          </DropdownMenuItem>
        )}
        {onCopyId && onDelete && <DropdownMenuSeparator />}
        {onDelete && (
          <DropdownMenuItem disabled={disableDelete} onSelect={onDelete}>
            <Trash />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
