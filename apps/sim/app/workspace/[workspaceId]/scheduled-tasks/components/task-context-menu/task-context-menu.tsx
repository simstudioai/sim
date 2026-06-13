'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { Eye, Pencil, Trash } from '@/components/emcn/icons'
import type { ScheduledTask } from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'

interface TaskContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  /** The right-clicked task; its status decides which actions render. */
  task: ScheduledTask | null
  onSeeDetails: () => void
  onEdit: () => void
  onDelete: () => void
}

/**
 * Right-click menu for a calendar task pill. The action set follows the task's
 * lifecycle: upcoming (`pending`) tasks can still be edited or deleted, while
 * tasks that have started or finished only expose their read-only record.
 */
export function TaskContextMenu({
  isOpen,
  position,
  onClose,
  task,
  onSeeDetails,
  onEdit,
  onDelete,
}: TaskContextMenuProps) {
  const isUpcoming = task?.status === 'pending'

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
        {isUpcoming ? (
          <>
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete}>
              <Trash />
              Delete
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onSelect={onSeeDetails}>
            <Eye />
            See details
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
