import { describe, expect, it } from 'vitest'
import {
  dashboardAxisFormatter,
  dashboardRangeFromCalendar,
  dashboardRangeText,
  dashboardTimeLabel,
  dashboardZoomRange,
  parseDashboardCustomRange,
} from '@/lib/dashboards/time'

const range = { from: '2026-09-20T00:00:00.000Z', to: '2026-09-22T00:00:00.000Z' }

describe('dashboard time interactions', () => {
  it('preserves exact zoom instants through a URL round trip', () => {
    const from = '2026-09-20T17:26:54.766Z'
    const to = '2026-09-21T03:49:57.697Z'
    expect(parseDashboardCustomRange(from, to)).toEqual({ from, to })
  })
  it('interprets calendar input in the selected zone and includes the end minute', () => {
    expect(
      dashboardRangeFromCalendar('2026-09-20T10:30', '2026-09-20T11:30:59', 'America/Los_Angeles')
    ).toEqual({
      from: '2026-09-20T17:30:00.000Z',
      to: '2026-09-20T18:31:00.000Z',
    })
  })
  it('rejects skipped and ambiguous local times instead of silently shifting the range', () => {
    expect(() =>
      dashboardRangeFromCalendar('2026-03-08T02:30', '2026-03-08T03:30:59', 'America/Los_Angeles')
    ).toThrow('does not exist')
    expect(() =>
      dashboardRangeFromCalendar('2026-11-01T01:30', '2026-11-01T03:30:59', 'America/Los_Angeles')
    ).toThrow('occurs twice')
  })
  it('accepts a reverse drag, clamps to query bounds, and ignores clicks and malformed ranges', () => {
    expect(
      dashboardZoomRange([Date.parse(range.to) + 5000, Date.parse(range.from) - 5000], range)
    ).toEqual(range)
    expect(
      dashboardZoomRange([Date.parse(range.from), Date.parse(range.from) + 100], range)
    ).toBeNull()
    expect(dashboardZoomRange(['bad', 100], range)).toBeNull()
    expect(dashboardZoomRange([Number.NaN, Number.POSITIVE_INFINITY], range)).toBeNull()
  })
  it('shows dates on short axes too, using the timezone at the point', () => {
    const stamp = Date.parse('2026-09-20T02:30:00Z')
    expect(dashboardAxisFormatter(range, 'America/Los_Angeles')(stamp)).toBe('Sep 19\n19:30')
    expect(dashboardTimeLabel(stamp, 'America/Los_Angeles')).toContain('PDT')
    expect(dashboardTimeLabel('2026-12-20T02:30:00Z', 'America/Los_Angeles')).toContain('PST')
  })

  it('keeps both ends of a range that repeats the same wall-clock minute across a DST fall-back', () => {
    const text = dashboardRangeText(
      { from: '2026-11-01T05:30:00.000Z', to: '2026-11-01T06:31:00.000Z' },
      'America/New_York'
    )
    expect(text).toBe('Nov 1, 01:30:00 EDT – Nov 1, 01:30:59 EST')
  })

  it('shows distinct endpoints for a sub-minute zoom range', () => {
    expect(
      dashboardRangeText(
        { from: '2026-09-20T14:30:00.000Z', to: '2026-09-20T14:30:01.000Z' },
        'UTC'
      )
    ).toBe('Sep 20, 14:30:00.000 UTC – Sep 20, 14:30:00.999 UTC')
  })
})
