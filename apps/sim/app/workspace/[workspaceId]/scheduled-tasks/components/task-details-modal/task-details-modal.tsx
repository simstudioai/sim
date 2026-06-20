'use client'

import { useEffect } from 'react'
import { format } from 'date-fns'
import { useParams } from 'next/navigation'
import {
  Calendar,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  chipFieldSurfaceClass,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import {
  PromptEditor,
  usePromptEditor,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components'
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
 * Status and the run time as copy fields, the prompt as a view-only chip editor.
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
      {task && <TaskDetailsContent task={task} onClose={onClose} />}
    </ChipModal>
  )
}

/**
 * Inner content, mounted only while a task is shown (the Radix portal unmounts
 * closed content). Holding the read-only editor here keeps its mention-data
 * queries from firing on page load and re-seeds from the task on each open.
 */
function TaskDetailsContent({ task, onClose }: { task: ScheduledTask; onClose: () => void }) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const editor = usePromptEditor({ workspaceId, initialValue: task.prompt })
  const setContexts = editor.setContexts

  /**
   * Re-registers the task's stored `@`-mentions once on open so resource chips
   * (files, tables, knowledge) render. Integration `@`-mentions and `/`-skills
   * chipify from the seeded text alone, so they render even without stored
   * contexts. Runs once per open since the content remounts each time it opens.
   */
  useEffect(() => {
    if (task.contexts && task.contexts.length > 0) setContexts(task.contexts)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only re-register
  }, [])

  return (
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
        <ChipModalField type='custom' title='Prompt'>
          <div className={cn(chipFieldSurfaceClass, 'max-h-[200px] overflow-y-auto px-1 py-0.5')}>
            <PromptEditor editor={editor} readOnly aria-label='Prompt' />
          </div>
        </ChipModalField>
      </ChipModalBody>
      <ChipModalFooter onCancel={onClose} primaryAction={{ label: 'Done', onClick: onClose }} />
    </>
  )
}
