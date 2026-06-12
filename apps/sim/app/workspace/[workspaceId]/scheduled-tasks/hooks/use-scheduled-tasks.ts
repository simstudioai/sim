'use client'

import { useCallback, useMemo, useState } from 'react'
import { generateId } from '@sim/utils/id'
import type { TaskDraft } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/task-modal'
import {
  bucketEventsByDay,
  bucketEventsByHour,
  type CalendarEvent,
  type ScheduledTask,
  taskToCalendarEvent,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'

/**
 * Materializes the task fields a captured draft describes. A launch time
 * already in the past is recorded as `completed` (it ran in the past); future
 * launches are `pending`. `running`/`error` only arrive with real run data.
 */
function taskFieldsFromDraft(draft: TaskDraft): Omit<ScheduledTask, 'id'> {
  const runAt = new Date(`${draft.launchDate}T${draft.launchTime}`)
  return {
    prompt: draft.prompt,
    contexts: draft.contexts,
    runAt,
    timezone: draft.timezone,
    status: runAt.getTime() <= Date.now() ? 'completed' : 'pending',
  }
}

export interface UseScheduledTasksReturn {
  tasks: ScheduledTask[]
  /** The task whose modal (edit or record) is open, or `null` when none is. */
  selectedTask: ScheduledTask | null
  /** Day-bucketed events for the month grid, chronological within each day. */
  eventsByDay: Map<string, CalendarEvent[]>
  /** Hour-bucketed events for the time grid, chronological within each slot. */
  eventsByHour: Map<string, CalendarEvent[]>
  addTask: (draft: TaskDraft) => void
  /** Rebuilds a task from an edited draft; clears the selection so its modal closes. */
  updateTask: (id: string, draft: TaskDraft) => void
  /** Removes a task; clears the selection too when it was the open one. */
  deleteTask: (id: string) => void
  openTask: (task: ScheduledTask) => void
  closeTask: () => void
}

/**
 * Local-only collection of scheduled tasks plus the open-modal selection.
 * This phase holds tasks in component state — persistence later swaps in
 * behind the same return shape.
 */
export function useScheduledTasks(): UseScheduledTasksReturn {
  const [tasks, setTasks] = useState<ScheduledTask[]>([])
  const [selectedTask, setSelectedTask] = useState<ScheduledTask | null>(null)

  const addTask = useCallback((draft: TaskDraft) => {
    setTasks((current) => [...current, { id: generateId(), ...taskFieldsFromDraft(draft) }])
  }, [])

  const updateTask = useCallback((id: string, draft: TaskDraft) => {
    setTasks((current) =>
      current.map((task) => (task.id === id ? { id, ...taskFieldsFromDraft(draft) } : task))
    )
    setSelectedTask((current) => (current?.id === id ? null : current))
  }, [])

  const deleteTask = useCallback((id: string) => {
    setTasks((current) => current.filter((task) => task.id !== id))
    setSelectedTask((current) => (current?.id === id ? null : current))
  }, [])

  const openTask = useCallback((task: ScheduledTask) => setSelectedTask(task), [])
  const closeTask = useCallback(() => setSelectedTask(null), [])

  const events = useMemo(
    () => tasks.map(taskToCalendarEvent).sort((a, b) => a.start.getTime() - b.start.getTime()),
    [tasks]
  )
  const eventsByDay = useMemo(() => bucketEventsByDay(events), [events])
  const eventsByHour = useMemo(() => bucketEventsByHour(events), [events])

  return {
    tasks,
    selectedTask,
    eventsByDay,
    eventsByHour,
    addTask,
    updateTask,
    deleteTask,
    openTask,
    closeTask,
  }
}
