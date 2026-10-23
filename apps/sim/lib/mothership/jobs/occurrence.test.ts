/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { nextJobOccurrence } from '@/lib/mothership/jobs/occurrence'

const quarterHourly = {
  cronExpression: '*/15 * * * *',
  timezone: 'UTC',
  excludedDates: null,
  endsAt: null,
}

describe('nextJobOccurrence', () => {
  it('keeps the next slot when the occurrence is claimed on time', () => {
    const occurrenceAt = new Date('2026-10-22T10:00:00Z')
    expect(
      nextJobOccurrence(quarterHourly, occurrenceAt, new Date('2026-10-22T10:00:30Z'))
    ).toEqual(new Date('2026-10-22T10:15:00Z'))
  })

  it('never runs again within the minimum cadence of a late claim', () => {
    const occurrenceAt = new Date('2026-10-22T10:00:00Z')
    expect(
      nextJobOccurrence(quarterHourly, occurrenceAt, new Date('2026-10-22T10:14:00Z'))
    ).toEqual(new Date('2026-10-22T10:30:00Z'))
  })

  it('runs a cron tighter than the minimum cadence at most every fifteen minutes', () => {
    const everyMinute = { ...quarterHourly, cronExpression: '* * * * *' }
    const occurrenceAt = new Date('2026-10-22T10:00:00Z')
    expect(nextJobOccurrence(everyMinute, occurrenceAt, occurrenceAt)).toEqual(
      new Date('2026-10-22T10:15:00Z')
    )
  })
})
