/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import type { WorkspaceScheduleRow } from '@/lib/api/contracts/schedules'
import {
  bucketEventsByDay,
  bucketEventsByHour,
  dayKey,
  hourKey,
  type ScheduledTask,
  scheduleToTasks,
  taskToCalendarEvent,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'

function makeTask(overrides: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: 't1',
    scheduleId: 's1',
    prompt: 'Summarize yesterday',
    runAt: new Date('2026-06-10T14:30:00.000Z'),
    timezone: 'UTC',
    status: 'pending',
    recurring: false,
    ...overrides,
  }
}

const RANGE_START = new Date('2026-06-08T00:00:00.000Z')
const RANGE_END = new Date('2026-06-14T23:59:59.999Z')
const NOW = new Date('2026-06-10T00:00:00.000Z')

function makeRow(overrides: Partial<WorkspaceScheduleRow>): WorkspaceScheduleRow {
  return {
    id: 's1',
    sourceType: 'job',
    prompt: 'Summarize yesterday',
    timezone: 'UTC',
    status: 'active',
    cronExpression: null,
    nextRunAt: null,
    lastRanAt: null,
    lastFailedAt: null,
    excludedDates: null,
    endsAt: null,
    contexts: null,
    ...overrides,
  } as WorkspaceScheduleRow
}

describe('taskToCalendarEvent', () => {
  it('positions the event at the run time and keeps the task for click-through', () => {
    const task = makeTask({ id: 'abc' })
    const event = taskToCalendarEvent(task)
    expect(event.id).toBe('abc')
    expect(event.start).toBe(task.runAt)
    expect(event.title).toBe('Summarize yesterday')
    expect(event.task).toBe(task)
  })

  it('truncates long prompts and falls back to a default title', () => {
    const longPrompt = 'x'.repeat(120)
    const truncated = taskToCalendarEvent(makeTask({ prompt: longPrompt }))
    expect(truncated.title.length).toBeLessThan(longPrompt.length)

    const fallback = taskToCalendarEvent(makeTask({ prompt: '   ' }))
    expect(fallback.title).toBe('Scheduled task')
  })

  it('derives the same event shape for every status', () => {
    const statuses = ['pending', 'error', 'completed'] as const
    const titles = statuses.map((status) => taskToCalendarEvent(makeTask({ status })).title)
    expect(new Set(titles).size).toBe(1)
  })
})

describe('scheduleToTasks', () => {
  it('renders an active one-time task as a single pending occurrence at its next run', () => {
    const tasks = scheduleToTasks(
      makeRow({ nextRunAt: '2026-06-11T09:00:00.000Z' }),
      RANGE_START,
      RANGE_END,
      NOW
    )
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ scheduleId: 's1', status: 'pending', recurring: false })
    expect(tasks[0].runAt.toISOString()).toBe('2026-06-11T09:00:00.000Z')
  })

  it('renders a completed one-time task at its last run', () => {
    const tasks = scheduleToTasks(
      makeRow({ status: 'completed', lastRanAt: '2026-06-09T09:00:00.000Z' }),
      RANGE_START,
      RANGE_END,
      NOW
    )
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      status: 'completed',
      runAt: new Date('2026-06-09T09:00:00.000Z'),
    })
  })

  it('marks the last run as error when the latest failure is at or after the last success', () => {
    const tasks = scheduleToTasks(
      makeRow({
        status: 'completed',
        lastRanAt: '2026-06-09T09:00:00.000Z',
        lastFailedAt: '2026-06-09T09:00:00.000Z',
      }),
      RANGE_START,
      RANGE_END,
      NOW
    )
    expect(tasks[0].status).toBe('error')
  })

  it('omits a one-time task whose run falls outside the visible range', () => {
    const tasks = scheduleToTasks(
      makeRow({ nextRunAt: '2026-07-01T09:00:00.000Z' }),
      RANGE_START,
      RANGE_END,
      NOW
    )
    expect(tasks).toHaveLength(0)
  })

  it('expands a recurring task into upcoming occurrences plus a last-run marker', () => {
    const tasks = scheduleToTasks(
      makeRow({
        cronExpression: '0 12 * * *',
        nextRunAt: '2026-06-10T12:00:00.000Z',
        lastRanAt: '2026-06-09T12:00:00.000Z',
      }),
      RANGE_START,
      RANGE_END,
      NOW
    )
    const pending = tasks.filter((t) => t.status === 'pending')
    const completed = tasks.filter((t) => t.status === 'completed')
    expect(pending.length).toBe(5) // Jun 10–14 noon (NOW is Jun 10 00:00)
    expect(pending.every((t) => t.recurring)).toBe(true)
    expect(completed).toHaveLength(1)
    expect(completed[0].runAt.toISOString()).toBe('2026-06-09T12:00:00.000Z')
  })

  it('skips individually-deleted occurrences of a recurring task', () => {
    const tasks = scheduleToTasks(
      makeRow({
        cronExpression: '0 12 * * *',
        excludedDates: ['2026-06-12T12:00:00.000Z'],
      }),
      RANGE_START,
      RANGE_END,
      NOW
    )
    const runs = tasks.filter((t) => t.status === 'pending').map((t) => t.runAt.toISOString())
    expect(runs).not.toContain('2026-06-12T12:00:00.000Z')
  })

  it('produces nothing for a disabled schedule with no run history', () => {
    const tasks = scheduleToTasks(
      makeRow({ status: 'disabled', cronExpression: '0 12 * * *' }),
      RANGE_START,
      RANGE_END,
      NOW
    )
    expect(tasks).toHaveLength(0)
  })
})

describe('bucketing', () => {
  it('groups events by day and by hour', () => {
    const events = [
      taskToCalendarEvent(makeTask({ id: 'a', runAt: new Date('2026-06-10T14:30:00.000Z') })),
      taskToCalendarEvent(makeTask({ id: 'b', runAt: new Date('2026-06-10T14:45:00.000Z') })),
      taskToCalendarEvent(makeTask({ id: 'c', runAt: new Date('2026-06-11T09:00:00.000Z') })),
    ]

    const byDay = bucketEventsByDay(events)
    const firstDay = byDay.get(dayKey(events[0].start))
    expect(firstDay).toHaveLength(2)

    const byHour = bucketEventsByHour(events)
    const firstHour = byHour.get(hourKey(events[0].start, events[0].start.getHours()))
    expect(firstHour).toHaveLength(2)
    expect(byHour.size).toBe(2)
  })
})
