'use client'

import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDivider,
  PopoverItem,
} from '@/components/emcn'

interface ScheduleContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  menuRef: React.RefObject<HTMLDivElement | null>
  onClose: () => void
  isActive: boolean
  onEdit?: () => void
  onPause?: () => void
  onResume?: () => void
  onDelete?: () => void
}

export function ScheduleContextMenu({
  isOpen,
  position,
  menuRef,
  onClose,
  isActive,
  onEdit,
  onPause,
  onResume,
  onDelete,
}: ScheduleContextMenuProps) {
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
        {onEdit && (
          <PopoverItem
            onClick={() => {
              onEdit()
              onClose()
            }}
          >
            Edit
          </PopoverItem>
        )}
        {onEdit && <PopoverDivider />}
        {isActive && onPause && (
          <PopoverItem
            onClick={() => {
              onPause()
              onClose()
            }}
          >
            Pause
          </PopoverItem>
        )}
        {!isActive && onResume && (
          <PopoverItem
            onClick={() => {
              onResume()
              onClose()
            }}
          >
            Resume
          </PopoverItem>
        )}
        {(onPause || onResume) && onDelete && <PopoverDivider />}
        {onDelete && (
          <PopoverItem
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
