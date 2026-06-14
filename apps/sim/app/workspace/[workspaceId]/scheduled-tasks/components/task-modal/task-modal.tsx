'use client'

import { useEffect, useRef, useState } from 'react'
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
import { wallClockNow, zonedWallClockToUtc } from '@/lib/core/utils/timezone'
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
import { useTimezone } from '@/hooks/queries/general-settings'
import type { ChatContext } from '@/stores/panel'

const DEFAULT_TIME = '09:00'
const PAST_LAUNCH_MESSAGE = "You can't schedule a one-time task in the past"

/** Whether a one-time launch has already passed, evaluated in the task's `timezone`. */
function isLaunchInPast(launchDate: string, launchTime: string, timezone: string): boolean {
  return zonedWallClockToUtc(`${launchDate}T${launchTime}`, timezone) < new Date()
}

/**
 * The next top of the hour in `timezone`, as a `{ date, time }` wall-clock pair.
 * The `Z` suffix keeps the step pure wall-clock arithmetic (adding an hour and
 * rolling the date at 23:xx), not a timezone conversion.
 */
function nextTopOfHour(timezone: string): { date: string; time: string } {
  const next = new Date(`${wallClockNow(timezone)}:00Z`)
  next.setUTCMinutes(0, 0, 0)
  next.setUTCHours(next.getUTCHours() + 1)
  return { date: next.toISOString().slice(0, 10), time: next.toISOString().slice(11, 16) }
}

/**
 * Seeds the launch date/time for a create. A slot with a specific hour uses it;
 * a whole-day slot (month cell) and the no-slot header action both default to
 * the next top of the hour in `timezone` when the target day is today — so the
 * modal never opens with a past, already-disabled default — and to 9am on a
 * future day.
 */
function defaultLaunch(
  slot: CalendarSlot | null | undefined,
  timezone: string
): { date: string; time: string } {
  if (slot?.time) return { date: format(slot.date, 'yyyy-MM-dd'), time: slot.time }
  const upcoming = nextTopOfHour(timezone)
  if (slot?.date) {
    const date = format(slot.date, 'yyyy-MM-dd')
    const today = wallClockNow(timezone).slice(0, 10)
    return date === today ? upcoming : { date, time: DEFAULT_TIME }
  }
  return upcoming
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

/** Pre-filled fields shared by the edit and duplicate flows. */
export interface TaskPrefill {
  prompt: string
  /** Stored `@`-mention contexts, re-registered so they carry over. */
  contexts?: ChatContext[]
  launchDate: string
  launchTime: string
  /** The task's own zone; the modal seeds AND submits in it so unchanged times never drift. */
  timezone: string
  recurrence: Recurrence
}

/** Seeds the modal when editing an existing task, recovered from its schedule. */
export interface TaskEditSeed extends TaskPrefill {
  scheduleId: string
}

interface TaskModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Slot seeding a create — the clicked day/time, or `null` from the header action. */
  slot?: CalendarSlot | null
  /** Seed for an edit; when set the modal opens in edit mode (Save + Delete). */
  edit?: TaskEditSeed | null
  /** Pre-fill for a create (duplicate): opens in create mode with every field copied. */
  prefill?: TaskPrefill | null
  /**
   * Receives the captured draft on submit (create and save alike). May return a
   * promise — the modal awaits it, keeping itself open until the task persists
   * and closing only on success, so a failed save never silently discards the draft.
   */
  onSubmit: (draft: TaskDraft) => void | Promise<void>
  /** Asks the parent to start the delete flow (which handles the recurring this/all choice). */
  onRequestDelete?: () => void
}

/**
 * The "schedule a task" modal, shared by create (blank, or pre-filled from a
 * duplicate) and edit (seeded from a task's schedule). The body is one prompt
 * surface — the chat input's editor, so `@` mentions resources and `/` invokes
 * skills exactly like talking to Sim — and the footer carries the recurrence,
 * launch date/time, and (edit only) Delete.
 */
export function TaskModal({
  open,
  onOpenChange,
  slot,
  edit,
  prefill,
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
        prefill={prefill}
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
  prefill,
  onSubmit,
  onRequestDelete,
}: Omit<TaskModalProps, 'open'>) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const source = edit ?? prefill
  const accountTimezone = useTimezone()
  const timezone = source?.timezone ?? accountTimezone
  const editor = usePromptEditor({ workspaceId, initialValue: source?.prompt })
  const setContexts = editor.setContexts

  /**
   * Re-registers a seeded task's stored `@`-mentions once on open: the editor
   * seeds from `initialValue` text only, never its contexts. Runs once per open
   * since the dialog's content remounts each time it opens.
   */
  useEffect(() => {
    if (source?.contexts && source.contexts.length > 0) setContexts(source.contexts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const seedFromSource =
    source &&
    !(
      source.recurrence.frequency === 'once' &&
      isLaunchInPast(source.launchDate, source.launchTime, timezone)
    )
  const seed = seedFromSource
    ? { date: source.launchDate, time: source.launchTime }
    : defaultLaunch(slot, timezone)
  const [launchDate, setLaunchDate] = useState(seed.date)
  const [launchTime, setLaunchTime] = useState(seed.time)
  const [recurrence, setRecurrence] = useState<Recurrence>(
    () => source?.recurrence ?? DEFAULT_RECURRENCE
  )
  const [submitting, setSubmitting] = useState(false)
  const launchEditedRef = useRef(false)

  /**
   * Re-seed a blank create's default launch when the effective zone resolves
   * after mount — `useTimezone()` starts on the browser fallback, so without
   * this the next-top-of-the-hour default (and its past-launch guard) would be
   * computed in the wrong zone and submitted in the resolved one. No-op once the
   * user edits the fields, and skipped for slot/edit/duplicate seeds, whose
   * launch is zone-stable (slot times are zone-independent; source seeds carry
   * the task's own fixed zone).
   */
  useEffect(() => {
    if (launchEditedRef.current || source || slot) return
    const next = defaultLaunch(null, timezone)
    setLaunchDate(next.date)
    setLaunchTime(next.time)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone])

  const editLaunchDate = (date: string) => {
    launchEditedRef.current = true
    setLaunchDate(date)
  }
  const editLaunchTime = (time: string) => {
    launchEditedRef.current = true
    setLaunchTime(time)
  }

  const close = () => onOpenChange(false)
  const isOneTime = recurrence.frequency === 'once'
  const isPastLaunch = isOneTime && isLaunchInPast(launchDate, launchTime, timezone)

  const promptText = editor.value.trim()

  /**
   * Submits the draft and waits for it to persist. The `submitting` guard blocks
   * a double-submit (Enter racing the click); on success the modal closes, on
   * failure it stays open so the draft survives — the mutation hook surfaces the
   * error via toast, so no message is duplicated here.
   */
  const handleSubmit = async () => {
    if (!promptText || isPastLaunch || submitting) return
    setSubmitting(true)
    try {
      await onSubmit({
        prompt: editor.getPlainValue().trim(),
        contexts: editor.contexts.length > 0 ? editor.contexts : undefined,
        launchDate,
        launchTime,
        timezone,
        recurrence,
      })
      close()
    } catch {
      setSubmitting(false)
    }
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
    { custom: <ChipDatePicker value={launchDate} onChange={editLaunchDate} flush /> },
    { custom: <ChipTimePicker value={launchTime} onChange={editLaunchTime} flush /> },
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
          label: submitting ? (edit ? 'Saving...' : 'Scheduling...') : edit ? 'Save' : 'Schedule',
          onClick: handleSubmit,
          disabled: !promptText || isPastLaunch || submitting,
          disabledTooltip: isPastLaunch ? PAST_LAUNCH_MESSAGE : undefined,
        }}
      />
    </>
  )
}
