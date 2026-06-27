'use client'

import { useTranslations } from 'next-intl'
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
  const t = useTranslations('auto')
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
        onContextMenu={(e) => e.preventDefault()}
      >
        {onCreateSchedule && (
          <DropdownMenuItem disabled={disableCreate} onSelect={onCreateSchedule}>
            <Plus />
            {t('new_scheduled_task')}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
