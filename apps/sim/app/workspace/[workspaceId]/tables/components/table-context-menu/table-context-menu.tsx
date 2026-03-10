'use client'

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'
import { Copy, Trash } from '@/components/emcn/icons'

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
  menuRef,
}: TableContextMenuProps) {
  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      variant='secondary'
      size='sm'
    >
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
        {onViewSchema && (
          <PopoverItem
            onClick={() => {
              onViewSchema()
              onClose()
            }}
          >
            View Schema
          </PopoverItem>
        )}
        {onRename && (
          <PopoverItem
            disabled={disableRename}
            onClick={() => {
              onRename()
              onClose()
            }}
          >
            Rename
          </PopoverItem>
        )}
        {(onViewSchema || onRename) && (onCopyId || onDelete) && <PopoverDivider />}
        {onCopyId && (
          <PopoverItem
            onClick={() => {
              onCopyId()
              onClose()
            }}
          >
            <Copy />
            Copy ID
          </PopoverItem>
        )}
        {onCopyId && onDelete && <PopoverDivider />}
        {onDelete && (
          <PopoverItem
            disabled={disableDelete}
            onClick={() => {
              onDelete()
              onClose()
            }}
          >
            <Trash />
            Delete
          </PopoverItem>
        )}
      </PopoverContent>
    </Popover>
  )
}
