import { describe, expect, it } from 'vitest'
import {
  cronToRecurrence,
  expandOccurrences,
  type Recurrence,
  recurrenceToCron,
  recurrenceToScheduleFields,
} from './recurrence'

const once: Recurrence = { frequency: 'once', weekdays: [], end: { type: 'never' } }

describe('recurrenceToCron', () => {
  it('returns null for a one-time task', () => {
    expect(recurrenceToCron(once, '2026-06-15', '09:30')).toBeNull()
  })

  it('builds a daily expression at the launch time', () => {
    expect(
      recurrenceToCron(
        { frequency: 'daily', weekdays: [], end: { type: 'never' } },
        '2026-06-15',
        '09:30'
      )
    ).toBe('30 9 * * *')
  })

  it('builds a weekly expression from the selected weekdays, sorted and deduped', () => {
    expect(
      recurrenceToCron(
        { frequency: 'weekly', weekdays: [3, 1, 1], end: { type: 'never' } },
        '2026-06-15',
        '08:00'
      )
    ).toBe('0 8 * * 1,3')
  })

  it('builds a monthly expression from the launch day-of-month', () => {
    expect(
      recurrenceToCron(
        { frequency: 'monthly', weekdays: [], end: { type: 'never' } },
        '2026-06-15',
        '07:05'
      )
    ).toBe('5 7 15 * *')
  })

  it('builds a monthly nth-weekday expression (2026-06-15 is the third Monday)', () => {
    expect(
      recurrenceToCron(
        { frequency: 'monthly', weekdays: [], monthlyMode: 'nth-weekday', end: { type: 'never' } },
        '2026-06-15',
        '09:30'
      )
    ).toBe('30 9 * * 1#3')
  })

  it('builds a monthly last-weekday expression', () => {
    expect(
      recurrenceToCron(
        { frequency: 'monthly', weekdays: [], monthlyMode: 'last-weekday', end: { type: 'never' } },
        '2026-06-29',
        '09:30'
      )
    ).toBe('30 9 * * 1#L')
  })

  it('clamps a 5th-occurrence nth-weekday to last-weekday so no month is skipped', () => {
    // 2026-06-29 is the fifth Monday of June; `#5` would skip months without one.
    expect(
      recurrenceToCron(
        { frequency: 'monthly', weekdays: [], monthlyMode: 'nth-weekday', end: { type: 'never' } },
        '2026-06-29',
        '09:30'
      )
    ).toBe('30 9 * * 1#L')
  })

  it('builds a yearly expression from the launch month and day', () => {
    expect(
      recurrenceToCron(
        { frequency: 'yearly', weekdays: [], end: { type: 'never' } },
        '2026-06-15',
        '09:30'
      )
    ).toBe('30 9 15 6 *')
  })

  it('preserves a custom expression verbatim', () => {
    expect(
      recurrenceToCron(
        { frequency: 'custom', weekdays: [], end: { type: 'never' }, cron: '*/5 * * * *' },
        '2026-06-15',
        '09:00'
      )
    ).toBe('*/5 * * * *')
  })
})

describe('recurrenceToScheduleFields', () => {
  it('resolves a one-time launch to the UTC instant of that wall-clock in the zone', () => {
    const fields = recurrenceToScheduleFields(once, '2026-06-15', '09:00', 'America/New_York')
    expect(fields.cronExpression).toBeNull()
    expect(fields.time).toBe('2026-06-15T13:00:00.000Z')
    expect(fields.lifecycle).toBe('persistent')
  })

  it('maps "ends after N" to maxRuns with an until_complete lifecycle', () => {
    const fields = recurrenceToScheduleFields(
      { frequency: 'daily', weekdays: [], end: { type: 'after', count: 5 } },
      '2026-06-15',
      '09:00',
      'UTC'
    )
    expect(fields.cronExpression).toBe('0 9 * * *')
    expect(fields.maxRuns).toBe(5)
    expect(fields.lifecycle).toBe('until_complete')
    expect(fields.endsAt).toBeUndefined()
  })

  it('maps "ends on date" to an end-of-day boundary in the zone', () => {
    const fields = recurrenceToScheduleFields(
      { frequency: 'daily', weekdays: [], end: { type: 'on', date: '2026-07-01' } },
      '2026-06-15',
      '09:00',
      'UTC'
    )
    expect(fields.endsAt).toBe('2026-07-01T23:59:59.000Z')
    expect(fields.maxRuns).toBeUndefined()
    expect(fields.lifecycle).toBe('persistent')
  })
})

describe('cronToRecurrence', () => {
  const anchor = new Date('2026-06-15T09:00:00Z')

  it('recovers a one-time task from a null cron', () => {
    const { recurrence } = cronToRecurrence({
      cronExpression: null,
      maxRuns: null,
      endsAt: null,
      anchor,
      timezone: 'UTC',
    })
    expect(recurrence.frequency).toBe('once')
  })

  it('recovers daily, weekly, and monthly cadences', () => {
    expect(
      cronToRecurrence({
        cronExpression: '30 9 * * *',
        maxRuns: null,
        endsAt: null,
        anchor,
        timezone: 'UTC',
      }).recurrence.frequency
    ).toBe('daily')

    const weekly = cronToRecurrence({
      cronExpression: '0 8 * * 1,3',
      maxRuns: null,
      endsAt: null,
      anchor,
      timezone: 'UTC',
    }).recurrence
    expect(weekly.frequency).toBe('weekly')
    expect(weekly.weekdays).toEqual([1, 3])

    const monthly = cronToRecurrence({
      cronExpression: '5 7 15 * *',
      maxRuns: null,
      endsAt: null,
      anchor,
      timezone: 'UTC',
    }).recurrence
    expect(monthly.frequency).toBe('monthly')
    expect(monthly.monthlyMode).toBe('day-of-month')
  })

  it('recovers monthly nth-weekday, monthly last-weekday, and yearly cadences', () => {
    const nthWeekday = cronToRecurrence({
      cronExpression: '30 9 * * 1#3',
      maxRuns: null,
      endsAt: null,
      anchor,
      timezone: 'UTC',
    }).recurrence
    expect(nthWeekday.frequency).toBe('monthly')
    expect(nthWeekday.monthlyMode).toBe('nth-weekday')

    const lastWeekday = cronToRecurrence({
      cronExpression: '30 9 * * 1#L',
      maxRuns: null,
      endsAt: null,
      anchor,
      timezone: 'UTC',
    }).recurrence
    expect(lastWeekday.frequency).toBe('monthly')
    expect(lastWeekday.monthlyMode).toBe('last-weekday')

    expect(
      cronToRecurrence({
        cronExpression: '30 9 15 6 *',
        maxRuns: null,
        endsAt: null,
        anchor,
        timezone: 'UTC',
      }).recurrence.frequency
    ).toBe('yearly')
  })

  it("accepts croner's alternate Sunday digit (7) for monthly weekday anchors", () => {
    const nth = cronToRecurrence({
      cronExpression: '30 9 * * 7#3',
      maxRuns: null,
      endsAt: null,
      anchor,
      timezone: 'UTC',
    }).recurrence
    expect(nth.frequency).toBe('monthly')
    expect(nth.monthlyMode).toBe('nth-weekday')

    const last = cronToRecurrence({
      cronExpression: '30 9 * * 7#L',
      maxRuns: null,
      endsAt: null,
      anchor,
      timezone: 'UTC',
    }).recurrence
    expect(last.frequency).toBe('monthly')
    expect(last.monthlyMode).toBe('last-weekday')
  })

  it('leaves a 5th-occurrence (#5) cron as custom so its month-skipping is preserved', () => {
    const { recurrence } = cronToRecurrence({
      cronExpression: '30 9 * * 1#5',
      maxRuns: null,
      endsAt: null,
      anchor,
      timezone: 'UTC',
    })
    expect(recurrence.frequency).toBe('custom')
    expect(recurrence.cron).toBe('30 9 * * 1#5')
  })

  it('falls back to custom for an expression it did not author', () => {
    const { recurrence } = cronToRecurrence({
      cronExpression: '*/5 * * * *',
      maxRuns: null,
      endsAt: null,
      anchor,
      timezone: 'UTC',
    })
    expect(recurrence.frequency).toBe('custom')
    expect(recurrence.cron).toBe('*/5 * * * *')
  })

  it('recovers the end boundary from maxRuns and endsAt', () => {
    expect(
      cronToRecurrence({
        cronExpression: '0 9 * * *',
        maxRuns: 5,
        endsAt: null,
        anchor,
        timezone: 'UTC',
      }).recurrence.end
    ).toEqual({ type: 'after', count: 5 })

    expect(
      cronToRecurrence({
        cronExpression: '0 9 * * *',
        maxRuns: null,
        endsAt: '2026-07-01T23:59:59Z',
        anchor,
        timezone: 'UTC',
      }).recurrence.end
    ).toEqual({ type: 'on', date: '2026-07-01' })
  })
})

describe('expandOccurrences', () => {
  const base = {
    cronExpression: '0 12 * * *',
    timezone: 'UTC',
    rangeStart: new Date('2026-06-01T00:00:00Z'),
    rangeEnd: new Date('2026-06-03T23:59:59Z'),
    from: new Date('2026-05-31T00:00:00Z'),
  }

  it('materializes every upcoming occurrence inside the range', () => {
    const occurrences = expandOccurrences(base)
    expect(occurrences.map((d) => d.toISOString())).toEqual([
      '2026-06-01T12:00:00.000Z',
      '2026-06-02T12:00:00.000Z',
      '2026-06-03T12:00:00.000Z',
    ])
  })

  it('skips excluded occurrences', () => {
    const occurrences = expandOccurrences({ ...base, excludedDates: ['2026-06-02T12:00:00.000Z'] })
    expect(occurrences.map((d) => d.toISOString())).toEqual([
      '2026-06-01T12:00:00.000Z',
      '2026-06-03T12:00:00.000Z',
    ])
  })

  it('stops at the recurrence end boundary', () => {
    const occurrences = expandOccurrences({ ...base, endsAt: new Date('2026-06-02T12:00:00Z') })
    expect(occurrences.map((d) => d.toISOString())).toEqual([
      '2026-06-01T12:00:00.000Z',
      '2026-06-02T12:00:00.000Z',
    ])
  })

  it('omits occurrences that already passed relative to `from`', () => {
    const occurrences = expandOccurrences({ ...base, from: new Date('2026-06-02T13:00:00Z') })
    expect(occurrences.map((d) => d.toISOString())).toEqual(['2026-06-03T12:00:00.000Z'])
  })

  it('materializes a monthly nth-weekday cron (third Monday of each month)', () => {
    const occurrences = expandOccurrences({
      cronExpression: '30 9 * * 1#3',
      timezone: 'UTC',
      rangeStart: new Date('2026-06-01T00:00:00Z'),
      rangeEnd: new Date('2026-08-31T23:59:59Z'),
      from: new Date('2026-05-31T00:00:00Z'),
    })
    expect(occurrences.map((d) => d.toISOString())).toEqual([
      '2026-06-15T09:30:00.000Z',
      '2026-07-20T09:30:00.000Z',
      '2026-08-17T09:30:00.000Z',
    ])
  })

  it('returns nothing for an invalid expression instead of throwing', () => {
    expect(expandOccurrences({ ...base, cronExpression: 'not-a-cron' })).toEqual([])
  })
})
