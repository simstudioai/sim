'use client'

import { useCallback, useMemo, useState } from 'react'
import { truncate } from '@sim/utils/string'
import { format } from 'date-fns'
import type { CreateScheduleBody, UpdateScheduleBody } from '@/lib/api/contracts/schedules'
import type {
  TaskDraft,
  TaskEditSeed,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/components/task-modal'
import {
  cronToRecurrence,
  recurrenceToScheduleFields,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/recurrence'
import {
  bucketEventsByDay,
  type CalendarEvent,
  type ScheduledTask,
  scheduleToTasks,
  taskToCalendarEvent,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'
import {
  useCreateSchedule,
  useDeleteSchedule,
  useExcludeOccurrence,
  useUpdateSchedule,
  useWorkspaceSchedules,
} from '@/hooks/queries/schedules'

/** Job title shown in audit logs / listings, derived from the prompt the user wrote. */
function titleFromPrompt(prompt: string): string {
  return truncate(prompt.trim(), 80) || 'Scheduled task'
}

function draftToCreateBody(draft: TaskDraft, workspaceId: string): CreateScheduleBody {
  const fields = recurrenceToScheduleFields(draft.recurrence, draft.launchDate, draft.launchTime)
  return {
    workspaceId,
    title: titleFromPrompt(draft.prompt),
    prompt: draft.prompt,
    cronExpression: fields.cronExpression ?? undefined,
    time: fields.time,
    timezone: draft.timezone,
    lifecycle: fields.lifecycle,
    maxRuns: fields.maxRuns,
    endsAt: fields.endsAt,
    contexts: draft.contexts,
  }
}

/** Edit always sends every recurrence field so clearing an end boundary or switching cadence sticks. */
function draftToUpdateBody(draft: TaskDraft): Omit<UpdateScheduleBody, 'action'> {
  const fields = recurrenceToScheduleFields(draft.recurrence, draft.launchDate, draft.launchTime)
  return {
    title: titleFromPrompt(draft.prompt),
    prompt: draft.prompt,
    cronExpression: fields.cronExpression,
    time: fields.time,
    timezone: draft.timezone,
    lifecycle: fields.lifecycle,
    maxRuns: fields.maxRuns ?? null,
    endsAt: fields.endsAt ?? null,
    contexts: draft.contexts ?? [],
  }
}

export interface UseScheduledTasksParams {
  workspaceId: string
  /** Inclusive window the current view renders; bounds recurrence expansion. */
  rangeStart: Date
  rangeEnd: Date
}

export interface UseScheduledTasksReturn {
  isLoading: boolean
  /** Day-bucketed events feeding both the month grid and the time grid. */
  eventsByDay: Map<string, CalendarEvent[]>
  /** The task occurrence whose modal is open, or `null` when none is. */
  selectedTask: ScheduledTask | null
  openTask: (task: ScheduledTask) => void
  closeTask: () => void
  /** Recovers the modal's edit seed (recurrence, launch) from a task's schedule. */
  editSeedFor: (task: ScheduledTask) => TaskEditSeed | null
  createTask: (draft: TaskDraft) => void
  updateTask: (scheduleId: string, draft: TaskDraft) => void
  /** Deletes the whole task (one-time or the entire recurring series). */
  deleteTask: (scheduleId: string) => void
  /** Deletes a single occurrence of a recurring task. */
  deleteOccurrence: (scheduleId: string, occurrence: Date) => void
}

/**
 * Bridges the calendar to the persisted job-schedule backend: reads the
 * workspace's scheduled tasks, expands them into the occurrences visible in the
 * current range, and exposes create/edit/delete mutations. UI-only selection
 * state lives here; all task data flows through React Query.
 */
export function useScheduledTasks({
  workspaceId,
  rangeStart,
  rangeEnd,
}: UseScheduledTasksParams): UseScheduledTasksReturn {
  const { data: schedules = [], isLoading } = useWorkspaceSchedules(workspaceId)
  const createSchedule = useCreateSchedule()
  const updateSchedule = useUpdateSchedule()
  const deleteSchedule = useDeleteSchedule()
  const excludeOccurrence = useExcludeOccurrence()

  const [selectedTask, setSelectedTask] = useState<ScheduledTask | null>(null)

  const events = useMemo(() => {
    const now = new Date()
    return schedules
      .filter((schedule) => schedule.sourceType === 'job')
      .flatMap((schedule) => scheduleToTasks(schedule, rangeStart, rangeEnd, now))
      .map(taskToCalendarEvent)
      .sort((a, b) => a.start.getTime() - b.start.getTime())
  }, [schedules, rangeStart, rangeEnd])

  const eventsByDay = useMemo(() => bucketEventsByDay(events), [events])

  const openTask = useCallback((task: ScheduledTask) => setSelectedTask(task), [])
  const closeTask = useCallback(() => setSelectedTask(null), [])

  const editSeedFor = useCallback(
    (task: ScheduledTask): TaskEditSeed | null => {
      const schedule = schedules.find((row) => row.id === task.scheduleId)
      if (!schedule) return null
      const { recurrence, launchTime } = cronToRecurrence({
        cronExpression: schedule.cronExpression,
        maxRuns: schedule.maxRuns,
        endsAt: schedule.endsAt,
        anchor: task.runAt,
      })
      return {
        scheduleId: schedule.id,
        prompt: schedule.prompt ?? '',
        contexts: task.contexts,
        launchDate: format(task.runAt, 'yyyy-MM-dd'),
        launchTime,
        recurrence,
      }
    },
    [schedules]
  )

  const createTask = useCallback(
    (draft: TaskDraft) => createSchedule.mutate(draftToCreateBody(draft, workspaceId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId]
  )

  const updateTask = useCallback(
    (scheduleId: string, draft: TaskDraft) => {
      updateSchedule.mutate({ scheduleId, workspaceId, ...draftToUpdateBody(draft) })
      setSelectedTask((current) => (current?.scheduleId === scheduleId ? null : current))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId]
  )

  const deleteTask = useCallback(
    (scheduleId: string) => {
      deleteSchedule.mutate({ scheduleId, workspaceId })
      setSelectedTask((current) => (current?.scheduleId === scheduleId ? null : current))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId]
  )

  const deleteOccurrence = useCallback(
    (scheduleId: string, occurrence: Date) => {
      excludeOccurrence.mutate({ scheduleId, workspaceId, occurrence: occurrence.toISOString() })
      setSelectedTask((current) => (current?.scheduleId === scheduleId ? null : current))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId]
  )

  return {
    isLoading,
    eventsByDay,
    selectedTask,
    openTask,
    closeTask,
    editSeedFor,
    createTask,
    updateTask,
    deleteTask,
    deleteOccurrence,
  }
}
