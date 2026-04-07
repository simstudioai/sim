'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { Copy, Database, Pencil, Trash } from '@/components/emcn/icons'

interface TableContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onCopyId?: () => void
  onDelete?: () => void
  onViewSchema?: () => void
  onRename?: () => void
  disableDelete?: boolean
  disableRename?: boolean
  menuRef?: React.RefObject<HTMLDivElement | null>
}

export function TableContextMenu({
  isOpen,
  position,
  onClose,
  onCopyId,
  onDelete,
  onViewSchema,
  onRename,
  disableDelete = false,
  disableRename = false,
}: TableContextMenuProps) {
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
        {onViewSchema && (
          <DropdownMenuItem onSelect={onViewSchema}>
            <Database />
            View Schema
          </DropdownMenuItem>
        )}
        {onRename && (
          <DropdownMenuItem disabled={disableRename} onSelect={onRename}>
            <Pencil />
            Rename
          </DropdownMenuItem>
        )}
        {(onViewSchema || onRename) && (onCopyId || onDelete) && <DropdownMenuSeparator />}
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
