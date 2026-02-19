'use client'

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'

interface TableContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  onViewSchema?: () => void
  onCopyId?: () => void
  onDelete?: () => void
  disableDelete?: boolean
}

export function TableContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  onViewSchema,
  onCopyId,
  onDelete,
  disableDelete = false,
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
        {onViewSchema && (onCopyId || onDelete) && <PopoverDivider />}
        {onCopyId && (
          <PopoverItem
            onClick={() => {
              onCopyId()
              onClose()
            }}
          >
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
            Delete
          </PopoverItem>
        )}
      </PopoverContent>
    </Popover>
  )
}
