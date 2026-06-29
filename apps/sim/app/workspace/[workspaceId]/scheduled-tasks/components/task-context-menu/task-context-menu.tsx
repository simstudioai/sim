'use client'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { Duplicate as DuplicateIcon, Pause, Pencil, Play, Trash } from '@sim/emcn/icons'
import type { ScheduledTask } from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'

interface TaskContextMenuProps {
  isOpen: boolean
  position: { x: number; y: number }
  onClose: () => void
  /** The right-clicked task; its status decides which actions render. */
  task: ScheduledTask | null
  onEdit: () => void
  /** Opens a new-task modal pre-filled from this task. */
  onDuplicate: () => void
  /** Pauses an active recurring task — suspends its future runs. */
  onPause: () => void
  /** Resumes a paused recurring task. */
  onResume: () => void
  onDelete: () => void
}

/**
 * Right-click menu for a calendar task pill. Upcoming (`pending`) tasks can be
 * edited or deleted, and recurring ones paused or resumed; any task can be
 * duplicated into a new one. Finished tasks open their read-only record on
 * click, so the menu only offers Duplicate.
 */
export function TaskContextMenu({
  isOpen,
  position,
  onClose,
  task,
  onEdit,
  onDuplicate,
  onPause,
  onResume,
  onDelete,
}: TaskContextMenuProps) {
  const isUpcoming = task?.status === 'pending'
  /** Pause/Resume applies to recurring tasks only — one-time tasks carry no cadence. */
  const canPauseResume = isUpcoming && task?.recurring === true

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
            {canPauseResume &&
              (task?.disabled ? (
                <DropdownMenuItem onSelect={onResume}>
                  <Play />
                  Resume
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onSelect={onPause}>
                  <Pause />
                  Pause
                </DropdownMenuItem>
              ))}
            <DropdownMenuItem onSelect={onDuplicate}>
              <DuplicateIcon />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete}>
              <Trash />
              Delete
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem onSelect={onDuplicate}>
            <DuplicateIcon />
            Duplicate
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
