'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ChipDatePicker,
  ChipModal,
  ChipModalFooter,
  type ChipModalFooterSlotAction,
  ChipModalHeader,
  ChipModalPromptBody,
  ChipTimePicker,
} from '@sim/emcn'
import { Calendar } from '@sim/emcn/icons'
import { format } from 'date-fns'
import { useParams } from 'next/navigation'
import { wallClockNow, zonedWallClockToUtc } from '@/lib/core/utils/timezone'
import {
  PromptEditor,
  usePromptEditor,
} from '@/app/workspace/[workspaceId]/home/components/user-input/components'
import { RecurrenceSection } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/task-modal/recurrence-section'
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
 * duplicate) and edit (seeded from a task's schedule). The body is the chat
 * input's editor — so `@` mentions resources and `/` invokes skills exactly like
 * talking to Sim — followed by the recurrence section; the footer carries the
 * launch date/time and (edit only) Delete.
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
  const [submitting, setSubmitting] = useState(false)

  /**
   * While a save is in flight, swallow every dismiss path — Cancel, header X,
   * Escape, and overlay click all route through this one handler — so an
   * in-progress create/edit can't be abandoned and lose its draft. `submitting`
   * lives here (not in the unmounted-on-close content) so this guard can see it.
   *
   * The programmatic close on a *successful* submit is intentionally NOT blocked:
   * `handleSubmit` runs in the pre-submit render where `submitting` was still
   * false, so its `close()` resolves to that render's handler and passes through,
   * while user dismisses fire from the current (submitting) render and are caught
   * here. Keep `submitting` as render state — moving it to a ref or memoizing this
   * handler with `submitting` in deps would make the success-close start blocking.
   */
  const handleOpenChange = (next: boolean) => {
    if (!next && submitting) return
    onOpenChange(next)
  }

  return (
    <ChipModal
      open={open}
      onOpenChange={handleOpenChange}
      size='lg'
      srTitle={edit ? 'Edit scheduled task' : 'New scheduled task'}
    >
      <TaskModalContent
        onOpenChange={handleOpenChange}
        slot={slot}
        edit={edit}
        prefill={prefill}
        onSubmit={onSubmit}
        onRequestDelete={onRequestDelete}
        submitting={submitting}
        setSubmitting={setSubmitting}
      />
    </ChipModal>
  )
}

interface TaskModalContentProps extends Omit<TaskModalProps, 'open'> {
  /** Whether a save is in flight — owned by {@link TaskModal} so the dismiss guard can read it. */
  submitting: boolean
  setSubmitting: (submitting: boolean) => void
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
  submitting,
  setSubmitting,
}: TaskModalContentProps) {
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
  const launchEditedRef = useRef(false)
  /**
   * Synchronous mirror of `submitting` that gates {@link handleSubmit}. The
   * `submitting` state only reflects after a re-render, so two invocations in the
   * same tick (Enter racing the click) could both pass a state-based guard; the
   * ref flips immediately, so the second is rejected before it can fire a second
   * mutation.
   */
  const submittingRef = useRef(false)

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
   * Submits the draft and waits for it to persist. The synchronous
   * {@link submittingRef} guard blocks a double-submit (Enter racing the click).
   * The modal closes only when the save resolves; a rejection leaves it open so
   * the draft survives — the mutation hook already surfaces the error via toast,
   * so it is swallowed here rather than duplicated. Both the ref and the
   * `submitting` state are always cleared, so the button can never stick disabled
   * while the modal stays open.
   */
  const handleSubmit = async () => {
    if (!promptText || isPastLaunch || submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    const persisted = await Promise.resolve(
      onSubmit({
        prompt: editor.getPlainValue().trim(),
        contexts: editor.contexts.length > 0 ? editor.contexts : undefined,
        launchDate,
        launchTime,
        timezone,
        recurrence,
      })
    )
      .then(() => true)
      .catch(() => false)
    submittingRef.current = false
    setSubmitting(false)
    if (persisted) close()
  }

  /**
   * Footer secondary actions — the launch date/time pickers and (edit only)
   * Delete. Delete is disabled while `submitting` because it bypasses the
   * dismiss guard — it closes the modal via `closeTask`, not the guarded
   * `onOpenChange` — so without the lock an in-flight edit and a delete could
   * run against the same task at once. Recurrence lives in the body, not here.
   */
  const secondaryActions: ChipModalFooterSlotAction[] = [
    ...(edit && onRequestDelete
      ? [
          {
            label: 'Delete',
            variant: 'destructive' as const,
            onClick: onRequestDelete,
            disabled: submitting,
          },
        ]
      : []),
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
      <RecurrenceSection recurrence={recurrence} onChange={setRecurrence} launchDate={launchDate} />
      <ChipModalFooter
        onCancel={close}
        cancelDisabled={submitting}
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
