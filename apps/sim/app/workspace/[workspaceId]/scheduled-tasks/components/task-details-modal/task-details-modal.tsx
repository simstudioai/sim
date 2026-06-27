'use client'

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
import { useTranslations } from 'next-intl'

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
      {/* Key by the occurrence id so switching tasks while the modal stays open
          remounts the content — the editor seeds prompt + contexts on mount, so
          without a fresh mount it would keep showing the first task's prompt. */}
      {task && <TaskDetailsContent key={task.id} task={task} onClose={onClose} />}
    </ChipModal>
  )
}

/**
 * Inner content, mounted only while a task is shown (the Radix portal unmounts
 * closed content). Holding the read-only editor here keeps its mention-data
 * queries from firing on page load and re-seeds from the task on each open.
 */
function TaskDetailsContent({ task, onClose }: { task: ScheduledTask; onClose: () => void }) {
  const t = useTranslations('auto')
  const { workspaceId } = useParams<{ workspaceId: string }>()
  /**
   * Seed the stored resource mentions (files, tables, knowledge) as the editor's
   * initial contexts — these can't be recovered from the prompt text alone. The
   * mount chipify pass then merges integration `@`-mentions and `/`-skills on top
   * (they DO chipify from text), so the overlay renders the full set. Seeding is
   * deliberate over a post-mount `setContexts`, which would clobber the
   * auto-registered integration/skill contexts.
   */
  const editor = usePromptEditor({
    workspaceId,
    initialValue: task.prompt,
    initialContexts: task.contexts,
  })

  return (
    <>
      <ChipModalHeader icon={Calendar} onClose={onClose}>
        {t('scheduled_task')}
      </ChipModalHeader>
      <ChipModalBody>
        <ChipModalField type='copy' title={t('status')} value={STATUS_COPY[task.status].label} />
        <ChipModalField
          type='copy'
          title={STATUS_COPY[task.status].timeTitle}
          value={format(task.runAt, "EEEE, MMMM d, yyyy 'at' h:mm a")}
        />
        <ChipModalField type='custom' title={t('prompt')}>
          <div className={cn(chipFieldSurfaceClass, 'max-h-[200px] overflow-y-auto px-1 py-0.5')}>
            <PromptEditor editor={editor} readOnly aria-label={t('prompt')} />
          </div>
        </ChipModalField>
      </ChipModalBody>
      <ChipModalFooter onCancel={onClose} primaryAction={{ label: 'Done', onClick: onClose }} />
    </>
  )
}
