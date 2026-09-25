import { describe, expect, it } from 'vitest'
import type { WorkspaceScheduleRow } from '@/lib/api/contracts/schedules'
import {
  type ScheduledTask,
  scheduleToTasks,
  taskToCalendarEvent,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'

function makeTask(overrides: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: 't1',
    scheduleId: 's1',
    sourceUserId: 'user-1',
    prompt: 'Summarize yesterday',
    runAt: new Date('2026-06-10T14:30:00.000Z'),
    timezone: 'UTC',
    status: 'pending',
    recurring: false,
    disabled: false,
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
  it('shifts the position to the task timezone, not the run instant', () => {
    const task = makeTask({
      runAt: new Date('2026-06-10T14:30:00.000Z'),
      timezone: 'America/New_York',
    })
    const event = taskToCalendarEvent(task)
    // 14:30 UTC is 10:30 in New York (EDT, UTC-4) on this date.
    expect(event.start.getHours()).toBe(10)
    expect(event.start.getMinutes()).toBe(30)
    expect(event.start.getDate()).toBe(10)
  })
})

describe('scheduleToTasks', () => {
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

  it('expands a paused recurring schedule as disabled occurrences so it stays resumable', () => {
    const tasks = scheduleToTasks(
      makeRow({ status: 'disabled', cronExpression: '0 12 * * *' }),
      RANGE_START,
      RANGE_END,
      NOW
    )
    const pending = tasks.filter((t) => t.status === 'pending')
    expect(pending.length).toBe(5) // Jun 10–14 noon (NOW is Jun 10 00:00)
    expect(pending.every((t) => t.disabled)).toBe(true)
  })
})
