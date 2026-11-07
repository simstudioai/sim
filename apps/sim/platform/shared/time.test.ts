import { describe, expect, it } from 'vitest'
import {
  formatCalendarDate,
  formatClockTime,
  formatRelativeTime,
  formatTimeRange,
} from '@/platform/shared/time'

describe('activity time against a fixed reading instant', () => {
  const now = Date.UTC(2026, 10, 4, 12)
  it.each([
    [now + 10_000, 'now'],
    [now - 59_999, 'now'],
    [now - 60_000, '1m ago'],
    [Date.UTC(2026, 10, 4, 11, 48), '12m ago'],
    [Date.UTC(2026, 10, 4, 11), '1hr ago'],
    [Date.UTC(2026, 10, 3, 19), '17hrs ago'],
    [Date.UTC(2026, 10, 3, 12), '1d ago'],
    [Date.UTC(2026, 10, 2, 12, 0, 1), '1d ago'],
    [Date.UTC(2026, 10, 2, 12), 'Nov 2nd'],
    [Date.UTC(2026, 9, 11), 'Oct 11th'],
    [Date.UTC(2026, 9, 12), 'Oct 12th'],
    [Date.UTC(2026, 9, 13), 'Oct 13th'],
    [Date.UTC(2026, 9, 23), 'Oct 23rd'],
    [Date.UTC(2025, 11, 31, 23, 59), 'Dec 31st, 2025'],
  ])('formats %s as %s', (timestamp, label) => {
    expect(formatRelativeTime(timestamp, now)).toBe(label)
  })
})

it('keeps a chart day and its tooltip on the same leap day', () => {
  expect(formatCalendarDate('2024-02-29')).toBe('Feb 29')
  expect(formatCalendarDate('2024-02-29', 'full')).toBe('Feb 29, 2024')
  expect(formatCalendarDate('2024-02-29', 'weekday')).toBe('Thursday, February 29')
})

it('separates an absolute event instant from the viewer’s wall clock across DST', () => {
  const before = Date.UTC(2026, 2, 8, 9, 59)
  expect(formatClockTime(before)).toBe('9:59 AM')
  expect(formatClockTime(before, 'America/Los_Angeles')).toBe('1:59 AM')
  expect(formatClockTime(before + 60_000, 'America/Los_Angeles')).toBe('3:00 AM')
})

it.each([
  [630, 675, '10:30–11:15 AM'],
  [690, 750, '11:30 AM–12:30 PM'],
  [720, 765, '12:00–12:45 PM'],
  [1410, 1455, '11:30 PM–12:15 AM'],
])('formats a calendar range from minute %i to %i as %s', (start, end, label) => {
  expect(formatTimeRange(start, end)).toBe(label)
})
