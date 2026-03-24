'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { Pause, Pencil, Play, Trash } from '@/components/emcn/icons'

interface ScheduleContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
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
  onClose,
  isActive,
  onEdit,
  onPause,
  onResume,
  onDelete,
}: ScheduleContextMenuProps) {
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
        {onEdit && (
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil />
            Edit
          </DropdownMenuItem>
        )}
        {onEdit && <DropdownMenuSeparator />}
        {isActive && onPause && (
          <DropdownMenuItem onSelect={onPause}>
            <Pause />
            Pause
          </DropdownMenuItem>
        )}
        {!isActive && onResume && (
          <DropdownMenuItem onSelect={onResume}>
            <Play />
            Resume
          </DropdownMenuItem>
        )}
        {(onPause || onResume) && onDelete && <DropdownMenuSeparator />}
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
