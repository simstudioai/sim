'use client'

import { useState } from 'react'
import { format } from 'date-fns'
import { useParams } from 'next/navigation'
import {
  Calendar,
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
import { RecurrenceControl } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/task-modal/recurrence-control'
import type { CalendarSlot } from '@/app/workspace/[workspaceId]/scheduled-tasks/hooks/use-calendar'
import {
  DEFAULT_RECURRENCE,
  type Recurrence,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/recurrence'
import type { ChatContext } from '@/stores/panel'

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone
const DEFAULT_TIME = '09:00'
const PAST_LAUNCH_MESSAGE = "You can't schedule a one-time task in the past"

/** Whether a one-time launch datetime has already passed, at minute granularity. */
function isLaunchInPast(launchDate: string, launchTime: string): boolean {
  return new Date(`${launchDate}T${launchTime}`) < new Date()
}

/** The data a task create or edit captures. */
export interface TaskDraft {
  prompt: string
  /** Resources the prompt `@`-mentions / skills it `/`-invokes, when any. */
  contexts?: ChatContext[]
  launchDate: string
  launchTime: string
  timezone: string
  recurrence: Recurrence
}

/** Seeds the modal when editing an existing task, recovered from its schedule. */
export interface TaskEditSeed {
  scheduleId: string
  prompt: string
  launchDate: string
  launchTime: string
  recurrence: Recurrence
}

interface TaskModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Slot seeding a create — the clicked day/time, or `null` from the header action. */
  slot?: CalendarSlot | null
  /** Seed for an edit; when set the modal opens in edit mode. */
  edit?: TaskEditSeed | null
  /** Receives the captured draft on submit (create and save alike). */
  onSubmit: (draft: TaskDraft) => void
  /** Asks the parent to start the delete flow (which handles the recurring this/all choice). */
  onRequestDelete?: () => void
}

/**
 * The "schedule a task" modal, shared by create (seeded from a calendar slot)
 * and edit (seeded from a task's schedule). The body is one prompt surface —
 * the chat input's editor, so `@` mentions resources and `/` invokes skills
 * exactly like talking to Sim — and the footer carries the recurrence, launch
 * date/time, and (edit only) Delete.
 */
export function TaskModal({
  open,
  onOpenChange,
  slot,
  edit,
  onSubmit,
  onRequestDelete,
}: TaskModalProps) {
  return (
    <ChipModal
      open={open}
      onOpenChange={onOpenChange}
      size='lg'
      srTitle={edit ? 'Edit scheduled task' : 'New scheduled task'}
    >
      <TaskModalContent
        onOpenChange={onOpenChange}
        slot={slot}
        edit={edit}
        onSubmit={onSubmit}
        onRequestDelete={onRequestDelete}
      />
    </ChipModal>
  )
}

/**
 * Inner content, mounted only while the dialog is open (the Radix portal
 * unmounts closed content). Holding the editor here keeps its mention-data
 * queries from firing on page load and re-seeds from `edit`/`slot` on each open.
 */
function TaskModalContent({
  onOpenChange,
  slot,
  edit,
  onSubmit,
  onRequestDelete,
}: Omit<TaskModalProps, 'open'>) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const editor = usePromptEditor({ workspaceId, initialValue: edit?.prompt })
  const [launchDate, setLaunchDate] = useState(
    () => edit?.launchDate ?? format(slot?.date ?? new Date(), 'yyyy-MM-dd')
  )
  const [launchTime, setLaunchTime] = useState(() => edit?.launchTime ?? slot?.time ?? DEFAULT_TIME)
  const [recurrence, setRecurrence] = useState<Recurrence>(
    () => edit?.recurrence ?? DEFAULT_RECURRENCE
  )

  const close = () => onOpenChange(false)
  const isOneTime = recurrence.frequency === 'once'
  const isPastLaunch = isOneTime && isLaunchInPast(launchDate, launchTime)

  const handleSubmit = () => {
    const prompt = editor.getPlainValue().trim()
    if (!prompt || isPastLaunch) return
    onSubmit({
      prompt,
      contexts: editor.contexts.length > 0 ? editor.contexts : undefined,
      launchDate,
      launchTime,
      timezone: DEFAULT_TIMEZONE,
      recurrence,
    })
    close()
  }

  const secondaryActions: ChipModalFooterSlotAction[] = [
    ...(edit && onRequestDelete
      ? [{ label: 'Delete', variant: 'destructive' as const, onClick: onRequestDelete }]
      : []),
    {
      custom: (
        <RecurrenceControl
          recurrence={recurrence}
          onChange={setRecurrence}
          launchDate={launchDate}
        />
      ),
    },
    { custom: <ChipDatePicker value={launchDate} onChange={setLaunchDate} flush /> },
    { custom: <ChipTimePicker value={launchTime} onChange={setLaunchTime} flush /> },
  ]

  return (
    <>
      <ChipModalHeader icon={Calendar} onClose={close}>
        {edit ? 'Edit scheduled task' : 'New scheduled task'}
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
          label: edit ? 'Save' : 'Schedule',
          onClick: handleSubmit,
          disabled: !editor.value.trim() || isPastLaunch,
          disabledTooltip: isPastLaunch ? PAST_LAUNCH_MESSAGE : undefined,
        }}
      />
    </>
  )
}
