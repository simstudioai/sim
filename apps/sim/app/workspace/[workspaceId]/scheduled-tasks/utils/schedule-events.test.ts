/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  bucketEventsByDay,
  bucketEventsByHour,
  dayKey,
  hourKey,
  type ScheduledTask,
  taskToCalendarEvent,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'

function makeTask(overrides: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: 't1',
    prompt: 'Summarize yesterday',
    runAt: new Date('2026-06-10T14:30:00.000Z'),
    timezone: 'UTC',
    status: 'pending',
    ...overrides,
  }
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
    const statuses = ['pending', 'running', 'error', 'completed'] as const
    const titles = statuses.map((status) => taskToCalendarEvent(makeTask({ status })).title)
    expect(new Set(titles).size).toBe(1)
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
