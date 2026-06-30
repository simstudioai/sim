'use client'

import {
  Calendar,
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import type { ScheduledTask } from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'

interface TaskDeleteDialogProps {
  /** The task targeted for deletion, or `null` to keep the dialog closed. */
  task: ScheduledTask | null
  onClose: () => void
  /** Delete just the targeted occurrence of a recurring task. */
  onDeleteOccurrence: (task: ScheduledTask) => void
  /** Delete a one-time task, or the entire recurring series. */
  onDeleteSeries: (task: ScheduledTask) => void
}

/**
 * Deletion confirmation for a scheduled task. A one-time task takes a single
 * confirm; a recurring task offers the calendar-app choice between deleting
 * this occurrence and deleting the whole series.
 */
export function TaskDeleteDialog({
  task,
  onClose,
  onDeleteOccurrence,
  onDeleteSeries,
}: TaskDeleteDialogProps) {
  if (task && !task.recurring) {
    return (
      <ChipConfirmModal
        open
        onOpenChange={(open) => {
          if (!open) onClose()
        }}
        title='Delete scheduled task'
        text='This task will be removed from the calendar and will not run.'
        confirm={{
          label: 'Delete',
          onClick: () => {
            onDeleteSeries(task)
            onClose()
          },
        }}
      />
    )
  }

  return (
    <ChipModal
      open={task !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      size='sm'
      srTitle='Delete recurring task'
    >
      {task && (
        <>
          <ChipModalHeader icon={Calendar} onClose={onClose}>
            Delete recurring task
          </ChipModalHeader>
          <ChipModalBody>
            <p className='px-2 text-[var(--text-body)] text-sm'>
              This is a recurring task. Delete only this occurrence, or the entire series?
            </p>
          </ChipModalBody>
          <ChipModalFooter
            onCancel={onClose}
            secondaryActions={[
              {
                label: 'This task',
                variant: 'destructive',
                onClick: () => {
                  onDeleteOccurrence(task)
                  onClose()
                },
              },
            ]}
            primaryAction={{
              label: 'All tasks',
              variant: 'destructive',
              onClick: () => {
                onDeleteSeries(task)
                onClose()
              },
            }}
          />
        </>
      )}
    </ChipModal>
  )
}
