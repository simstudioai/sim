'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { Plus } from '@/components/emcn/icons'

interface ScheduleListContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  onCreateSchedule?: () => void
  disableCreate?: boolean
}

export function ScheduleListContextMenu({
  isOpen,
  position,
  onClose,
  onCreateSchedule,
  disableCreate = false,
}: ScheduleListContextMenuProps) {
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
        {onCreateSchedule && (
          <DropdownMenuItem disabled={disableCreate} onSelect={onCreateSchedule}>
            <Plus />
            New scheduled task
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
