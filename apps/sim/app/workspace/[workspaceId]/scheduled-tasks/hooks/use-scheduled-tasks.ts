'use client'

import { useCallback, useMemo } from 'react'
import { truncate } from '@sim/utils/string'
import { useQueryState } from 'nuqs'
import type { CreateScheduleBody, UpdateScheduleBody } from '@/lib/api/contracts/schedules'
import { zonedWallClock } from '@/lib/core/utils/timezone'
import type {
  TaskDraft,
  TaskEditSeed,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/components/task-modal'
import {
  taskIdParam,
  taskIdUrlKeys,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/search-params'
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
  useDisableSchedule,
  useExcludeOccurrence,
  useResumeSchedule,
  useUpdateSchedule,
  useWorkspaceSchedules,
} from '@/hooks/queries/schedules'

/** Job title shown in audit logs / listings, derived from the prompt the user wrote. */
function titleFromPrompt(prompt: string): string {
  return truncate(prompt.trim(), 80) || 'Scheduled task'
}

function draftToCreateBody(draft: TaskDraft, workspaceId: string): CreateScheduleBody {
  const fields = recurrenceToScheduleFields(
    draft.recurrence,
    draft.launchDate,
    draft.launchTime,
    draft.timezone
  )
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
  const fields = recurrenceToScheduleFields(
    draft.recurrence,
    draft.launchDate,
    draft.launchTime,
    draft.timezone
  )
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
  /** Resolves once the create persists; rejects on failure so the modal stays open. */
  createTask: (draft: TaskDraft) => Promise<void>
  /** Resolves once the edit persists; rejects on failure so the modal stays open. */
  updateTask: (scheduleId: string, draft: TaskDraft) => Promise<void>
  /** Deletes the whole task (one-time or the entire recurring series). */
  deleteTask: (scheduleId: string) => void
  /** Deletes a single occurrence of a recurring task. */
  deleteOccurrence: (scheduleId: string, occurrence: Date) => void
  /** Pauses a recurring task — suspends future runs until resumed. */
  pauseTask: (scheduleId: string) => void
  /** Resumes a paused recurring task, recomputing its next run from the cron. */
  resumeTask: (scheduleId: string) => void
}

/**
 * Bridges the calendar to the persisted job-schedule backend: reads the
 * workspace's scheduled tasks, expands them into the occurrences visible in the
 * current range, and exposes create/edit/delete mutations. The open task lives
 * in the URL (`?taskId=`, deep-linkable — see {@link taskIdParam}) and the task
 * object is derived from the loaded occurrences; all task data flows through
 * React Query.
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
  const disableSchedule = useDisableSchedule()
  const resumeSchedule = useResumeSchedule()

  const [taskId, setTaskId] = useQueryState(taskIdParam.key, {
    ...taskIdParam.parser,
    ...taskIdUrlKeys,
  })

  const events = useMemo(() => {
    const now = new Date()
    return schedules
      .filter((schedule) => schedule.sourceType === 'job')
      .flatMap((schedule) => scheduleToTasks(schedule, rangeStart, rangeEnd, now))
      .map(taskToCalendarEvent)
      .sort((a, b) => a.start.getTime() - b.start.getTime())
  }, [schedules, rangeStart, rangeEnd])

  const eventsByDay = useMemo(() => bucketEventsByDay(events), [events])

  /**
   * Occurrence lookup for the `?taskId=` deep link. First occurrence wins on a
   * duplicate id — a one-time schedule reuses its bare schedule id for both its
   * pending run and its last-run marker (mutually exclusive today, but the id's
   * meaning shifts as the run completes). Until schedules load — or when the
   * occurrence falls outside the current anchor/scope window — the id doesn't
   * resolve, `selectedTask` stays `null`, and the param lingers harmlessly; the
   * modal opens as soon as the id resolves.
   */
  const taskById = useMemo(() => {
    const byId = new Map<string, CalendarEvent>()
    for (const event of events) {
      if (!byId.has(event.task.id)) byId.set(event.task.id, event)
    }
    return byId
  }, [events])

  const selectedTask = taskId ? (taskById.get(taskId)?.task ?? null) : null

  const openTask = useCallback((task: ScheduledTask) => setTaskId(task.id), [setTaskId])
  const closeTask = useCallback(() => setTaskId(null), [setTaskId])

  /**
   * Mutation-driven closes replace the URL instead of pushing — Back must not
   * reopen a task the user just deleted/paused/resumed. Matches by schedule id
   * prefix because occurrence ids are `scheduleId`, `scheduleId:<runAt ISO>`,
   * or `scheduleId:last` (the ISO contains colons, so never split on `:`).
   */
  const clearTaskIdForSchedule = useCallback(
    (scheduleId: string) =>
      setTaskId(
        (current) =>
          current !== null && (current === scheduleId || current.startsWith(`${scheduleId}:`))
            ? null
            : current,
        { history: 'replace' }
      ),
    [setTaskId]
  )

  const editSeedFor = useCallback(
    (task: ScheduledTask): TaskEditSeed | null => {
      const schedule = schedules.find((row) => row.id === task.scheduleId)
      if (!schedule) return null
      const { recurrence, launchTime } = cronToRecurrence({
        cronExpression: schedule.cronExpression,
        maxRuns: schedule.maxRuns,
        endsAt: schedule.endsAt,
        anchor: task.runAt,
        timezone: schedule.timezone,
      })
      return {
        scheduleId: schedule.id,
        prompt: schedule.prompt ?? '',
        contexts: task.contexts,
        launchDate: zonedWallClock(task.runAt, schedule.timezone).slice(0, 10),
        launchTime,
        timezone: schedule.timezone,
        recurrence,
      }
    },
    [schedules]
  )

  const createTask = useCallback(
    async (draft: TaskDraft) => {
      await createSchedule.mutateAsync(draftToCreateBody(draft, workspaceId))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId]
  )

  const updateTask = useCallback(
    async (scheduleId: string, draft: TaskDraft) => {
      await updateSchedule.mutateAsync({ scheduleId, workspaceId, ...draftToUpdateBody(draft) })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId]
  )

  const deleteTask = useCallback(
    (scheduleId: string) => {
      deleteSchedule.mutate({ scheduleId, workspaceId })
      clearTaskIdForSchedule(scheduleId)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId]
  )

  const deleteOccurrence = useCallback(
    (scheduleId: string, occurrence: Date) => {
      excludeOccurrence.mutate({ scheduleId, workspaceId, occurrence: occurrence.toISOString() })
      clearTaskIdForSchedule(scheduleId)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId]
  )

  const pauseTask = useCallback(
    (scheduleId: string) => {
      disableSchedule.mutate({ scheduleId, workspaceId })
      clearTaskIdForSchedule(scheduleId)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId]
  )

  const resumeTask = useCallback(
    (scheduleId: string) => {
      resumeSchedule.mutate({ scheduleId, workspaceId })
      clearTaskIdForSchedule(scheduleId)
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
    pauseTask,
    resumeTask,
  }
}
