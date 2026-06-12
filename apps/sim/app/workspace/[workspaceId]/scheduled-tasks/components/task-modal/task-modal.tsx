'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { useParams } from 'next/navigation'
import {
  Calendar,
  ChipConfirmModal,
  ChipDatePicker,
  ChipModal,
  ChipModalFooter,
  type ChipModalFooterSlotAction,
  ChipModalHeader,
  ChipModalPromptBody,
  ChipTimePicker,
} from '@/components/emcn'
import {
  PromptEditor,
  usePromptEditor,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components'
import type { CalendarSlot } from '@/app/workspace/[workspaceId]/scheduled-tasks/hooks/use-calendar'
import type { ScheduledTask } from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'
import type { ChatContext } from '@/stores/panel'

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const DEFAULT_TIME = '09:00'
const PAST_LAUNCH_MESSAGE = "You can't schedule a task in the past"

/**
 * Whether the selected launch datetime has already passed, at minute
 * granularity in the local timezone — the same `Date` construction
 * `useScheduledTasks` uses to derive `runAt` from a draft.
 */
function isLaunchInPast(launchDate: string, launchTime: string): boolean {
  return new Date(`${launchDate}T${launchTime}`) < new Date()
}

/** The data a task create or edit captures. Persistence is wired in a later phase. */
export interface TaskDraft {
  prompt: string
  /** Resources the prompt `@`-mentions / skills it `/`-invokes, when any. */
  contexts?: ChatContext[]
  launchDate: string
  launchTime: string
  timezone: string
}

interface TaskModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Slot seeding a create — the clicked day/time, or `null` from the header action. */
  slot?: CalendarSlot | null
  /**
   * Existing pending task to edit. When set the fields seed from it, the
   * header and primary action read as an edit, and Delete joins the footer's
   * secondary cluster.
   */
  task?: ScheduledTask | null
  /** Receives the captured draft on submit (create and save alike). */
  onSubmit: (draft: TaskDraft) => void
  /** Deletes the task being edited. Provide together with `task`. */
  onDelete?: (id: string) => void
}

/**
 * The "schedule a task" modal, shared by create (seeded from a calendar slot)
 * and edit (seeded from a pending task) so both flows look identical. The
 * entire body is one prompt surface — the chat input's editor, so `@`
 * mentions resources and `/` invokes skills exactly like talking to Sim — and
 * the footer's secondary cluster carries Delete (edit only, behind a
 * {@link ChipConfirmModal}) ahead of the launch date/time. Submit hands the draft to the caller — local task state
 * this phase; it does not persist (the create API requires a recurring cron;
 * one-time launches at an exact datetime are not yet supported).
 */
export function TaskModal({ open, onOpenChange, slot, task, onSubmit, onDelete }: TaskModalProps) {
  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      size='md'
      srTitle={task ? 'Edit scheduled task' : 'New scheduled task'}
    >
      <TaskModalContent
        onOpenChange={onOpenChange}
        slot={slot}
        task={task}
        onSubmit={onSubmit}
        onDelete={onDelete}
      />
    </ChipModal>
  )
}

/**
 * Inner content, mounted only while the dialog is open (the Radix portal
 * unmounts closed content). Holding the editor here keeps its mention-data
 * queries from firing on page load, seeds the prompt and launch date/time
 * from `task` (edit) or `slot` (create) on each open, and resets on dismiss.
 */
function TaskModalContent({
  onOpenChange,
  slot,
  task,
  onSubmit,
  onDelete,
}: Omit<TaskModalProps, 'open'>) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const editor = usePromptEditor({ workspaceId, initialValue: task?.prompt })
  const [launchDate, setLaunchDate] = useState(() =>
    format(task?.runAt ?? slot?.date ?? new Date(), 'yyyy-MM-dd')
  )
  const [launchTime, setLaunchTime] = useState(() =>
    task ? format(task.runAt, 'HH:mm') : (slot?.time ?? DEFAULT_TIME)
  )
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  const close = () => onOpenChange(false)
  const isPastLaunch = isLaunchInPast(launchDate, launchTime)

  const handleSubmit = () => {
    const prompt = editor.getPlainValue().trim()
    if (!prompt || isLaunchInPast(launchDate, launchTime)) return
    const draft: TaskDraft = {
      prompt,
      contexts: editor.contexts.length > 0 ? editor.contexts : undefined,
      launchDate,
      launchTime,
      timezone: DEFAULT_TIMEZONE,
    }
    onSubmit(draft)
    close()
  }

  const secondaryActions: ChipModalFooterSlotAction[] = [
    ...(task && onDelete
      ? [
          {
            label: 'Delete',
            variant: 'destructive' as const,
            onClick: () => setConfirmDeleteOpen(true),
          },
        ]
      : []),
    { custom: <ChipDatePicker value={launchDate} onChange={setLaunchDate} flush /> },
    { custom: <ChipTimePicker value={launchTime} onChange={setLaunchTime} flush /> },
  ]

  return (
    <>
      <ChipModalHeader icon={Calendar} onClose={close}>
        {task ? 'Edit scheduled task' : 'New scheduled task'}
      </ChipModalHeader>
      <ChipModalPromptBody>
        <PromptEditor
          editor={editor}
          placeholder='Use @ and launch Sim to...'
          autoFocus
          onSubmit={handleSubmit}
        />
      </ChipModalPromptBody>
      <ChipModalFooter
        onCancel={close}
        secondaryActions={secondaryActions}
        primaryAction={{
          label: task ? 'Save' : 'Schedule',
          onClick: handleSubmit,
          disabled: !editor.value.trim() || isPastLaunch,
          disabledTooltip: isPastLaunch ? PAST_LAUNCH_MESSAGE : undefined,
        }}
      />
      {task && onDelete && (
        <ChipConfirmModal
          open={confirmDeleteOpen}
          onOpenChange={setConfirmDeleteOpen}
          title='Delete scheduled task'
          text='This task will be removed from the calendar and will not run.'
          confirm={{
            label: 'Delete',
            onClick: () => {
              setConfirmDeleteOpen(false)
              onDelete(task.id)
            },
          }}
        />
      )}
    </>
  )
}
