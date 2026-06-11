/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  bucketEventsByDay,
  bucketEventsByHour,
  dayKey,
  hourKey,
  toCalendarEvent,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'
import type { WorkspaceScheduleData } from '@/hooks/queries/schedules'

function makeSchedule(overrides: Partial<WorkspaceScheduleData>): WorkspaceScheduleData {
  // Test-only partial — the adapter reads just a handful of fields.
  return {
    id: 's1',
    nextRunAt: null,
    cronExpression: null,
    jobTitle: null,
    prompt: null,
    ...overrides,
  } as unknown as WorkspaceScheduleData
}

describe('toCalendarEvent', () => {
  it('returns null when nextRunAt is missing or unparseable', () => {
    expect(toCalendarEvent(makeSchedule({ nextRunAt: null }))).toBeNull()
    expect(toCalendarEvent(makeSchedule({ nextRunAt: 'not-a-date' }))).toBeNull()
  })

  it('maps a valid schedule to a positioned event', () => {
    const event = toCalendarEvent(
      makeSchedule({
        id: 'abc',
        nextRunAt: '2026-06-10T14:30:00.000Z',
        jobTitle: 'Daily report',
        cronExpression: '0 14 * * *',
      })
    )
    expect(event?.id).toBe('abc')
    expect(event?.title).toBe('Daily report')
    expect(event?.isRecurring).toBe(true)
    expect(event?.start.getTime()).toBe(new Date('2026-06-10T14:30:00.000Z').getTime())
  })

  it('falls back through jobTitle → prompt snippet → default title', () => {
    const longPrompt = 'x'.repeat(120)
    const fromPrompt = toCalendarEvent(
      makeSchedule({ nextRunAt: '2026-06-10T14:30:00.000Z', prompt: longPrompt })
    )
    expect(fromPrompt?.title.length).toBeLessThan(longPrompt.length)
    expect(fromPrompt?.isRecurring).toBe(false)

    const fallback = toCalendarEvent(makeSchedule({ nextRunAt: '2026-06-10T14:30:00.000Z' }))
    expect(fallback?.title).toBe('Scheduled task')
  })
})

describe('bucketing', () => {
  it('groups events by day and by hour', () => {
    const events = [
      toCalendarEvent(makeSchedule({ id: 'a', nextRunAt: '2026-06-10T14:30:00.000Z' })),
      toCalendarEvent(makeSchedule({ id: 'b', nextRunAt: '2026-06-10T14:45:00.000Z' })),
      toCalendarEvent(makeSchedule({ id: 'c', nextRunAt: '2026-06-11T09:00:00.000Z' })),
    ].filter((event): event is NonNullable<typeof event> => event !== null)

    const byDay = bucketEventsByDay(events)
    const firstDay = byDay.get(dayKey(events[0].start))
    expect(firstDay).toHaveLength(2)

    const byHour = bucketEventsByHour(events)
    const firstHour = byHour.get(hourKey(events[0].start, events[0].start.getHours()))
    expect(firstHour).toHaveLength(2)
    expect(byHour.size).toBe(2)
  })
})
