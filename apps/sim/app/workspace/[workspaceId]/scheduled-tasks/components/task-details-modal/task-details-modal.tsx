'use client'

import { format } from 'date-fns'
import {
  Calendar,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@/components/emcn'
import type {
  ScheduledTask,
  ScheduledTaskStatus,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'

/**
 * Plaintext copy per task state: the status label and the verb that titles the
 * run-time field — the tense carries the state ("Ran" is done, "Failed" errored).
 * No icons, no status colors, by design. Total over the status union for type
 * safety, though `pending` tasks open the edit `TaskModal` instead.
 */
const STATUS_COPY: Record<ScheduledTaskStatus, { label: string; timeTitle: string }> = {
  pending: { label: 'Pending', timeTitle: 'Runs' },
  error: { label: 'Error', timeTitle: 'Failed' },
  completed: { label: 'Completed', timeTitle: 'Ran' },
}

interface TaskDetailsModalProps {
  /** The running or finished task to show. `null` keeps the modal closed. */
  task: ScheduledTask | null
  onClose: () => void
}

/**
 * Read-only record modal for tasks that are running or already finished —
 * pending tasks open the edit `TaskModal` instead. Three plaintext fields:
 * Status and the run time as copy fields, the prompt as a view-only textarea.
 */
export function TaskDetailsModal({ task, onClose }: TaskDetailsModalProps) {
  return (
    <ChipModal
      open={task !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      size='md'
      srTitle='Scheduled task'
    >
      {task && (
        <>
          <ChipModalHeader icon={Calendar} onClose={onClose}>
            Scheduled task
          </ChipModalHeader>
          <ChipModalBody>
            <ChipModalField type='copy' title='Status' value={STATUS_COPY[task.status].label} />
            <ChipModalField
              type='copy'
              title={STATUS_COPY[task.status].timeTitle}
              value={format(task.runAt, "EEEE, MMMM d, yyyy 'at' h:mm a")}
            />
            <ChipModalField type='textarea' title='Prompt' value={task.prompt} viewOnly />
          </ChipModalBody>
          <ChipModalFooter onCancel={onClose} primaryAction={{ label: 'Done', onClick: onClose }} />
        </>
      )}
    </ChipModal>
  )
}
