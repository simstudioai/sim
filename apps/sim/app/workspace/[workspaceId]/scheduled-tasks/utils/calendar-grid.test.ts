/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  advanceAnchor,
  buildCalendarGrid,
  EVENT_CHIP_HEIGHT,
  formatHourLabel,
  formatScopeLabel,
  formatSlotTime,
  HOURS,
  layoutColumn,
  TIME_SLOT_HEIGHT,
  timeToOffset,
  visibleRange,
  WEEKDAY_LABELS,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/calendar-grid'

// June 10, 2026 is a Wednesday. June 1, 2026 is a Monday.
const ANCHOR = new Date(2026, 5, 10)
const TODAY = new Date(2026, 5, 10)

describe('buildCalendarGrid', () => {
  it('builds a Sunday-first month grid with spillover days', () => {
    const grid = buildCalendarGrid('month', ANCHOR, TODAY)
    if (grid.kind !== 'month') throw new Error('expected month grid')

    // May 31 (Sun) → Jul 4 (Sat) = 5 full weeks.
    expect(grid.weeks).toHaveLength(5)
    expect(grid.weeks.every((week) => week.length === 7)).toBe(true)

    const first = grid.weeks[0][0]
    expect(first.date).toEqual(new Date(2026, 4, 31))
    expect(first.isCurrentMonth).toBe(false)

    const flat = grid.weeks.flat()
    const tenth = flat.find((cell) => cell.date.getDate() === 10 && cell.isCurrentMonth)
    expect(tenth?.isToday).toBe(true)
    expect(flat.filter((cell) => cell.isToday)).toHaveLength(1)
  })

  it('builds a 7-day week grid starting Sunday with 24 hours', () => {
    const grid = buildCalendarGrid('week', ANCHOR, TODAY)
    if (grid.kind !== 'week') throw new Error('expected week grid')

    expect(grid.days).toHaveLength(7)
    expect(grid.days[0].date).toEqual(new Date(2026, 5, 7)) // Sunday
    expect(grid.hours).toEqual(HOURS)
  })

  it('builds a single-day grid for the anchor', () => {
    const grid = buildCalendarGrid('day', ANCHOR, TODAY)
    if (grid.kind !== 'day') throw new Error('expected day grid')

    expect(grid.day.date).toEqual(ANCHOR)
    expect(grid.day.isToday).toBe(true)
    expect(grid.hours).toHaveLength(24)
  })
})

describe('visibleRange', () => {
  it('pads the rendered span by a day each side to cover timezone offset slop', () => {
    // Week of Jun 7–13, 2026 (Sun–Sat); padded to Jun 6 → Jun 14.
    const { start, end } = visibleRange('week', ANCHOR)
    expect(start).toEqual(new Date(2026, 5, 6))
    expect(end.getDate()).toBe(14)
  })

  it('pads the single-day span to the neighboring days', () => {
    const { start, end } = visibleRange('day', ANCHOR)
    expect(start.getDate()).toBe(9)
    expect(end.getDate()).toBe(11)
  })
})

describe('advanceAnchor', () => {
  it('advances by the unit of the scope', () => {
    expect(advanceAnchor(ANCHOR, 'month', 1)).toEqual(new Date(2026, 6, 10))
    expect(advanceAnchor(ANCHOR, 'week', 1)).toEqual(new Date(2026, 5, 17))
    expect(advanceAnchor(ANCHOR, 'day', -1)).toEqual(new Date(2026, 5, 9))
  })
})

describe('formatScopeLabel', () => {
  it('formats per scope', () => {
    expect(formatScopeLabel('month', ANCHOR)).toBe('June 2026')
    expect(formatScopeLabel('week', ANCHOR)).toBe('Jun 7 – 13, 2026')
    expect(formatScopeLabel('day', ANCHOR)).toBe('June 10, 2026')
  })
})

describe('hour helpers', () => {
  it('formats 24h slot times and 12h gutter labels', () => {
    expect(formatSlotTime(7)).toBe('07:00')
    expect(formatSlotTime(0)).toBe('00:00')
    expect(formatHourLabel(0)).toBe('12 AM')
    expect(formatHourLabel(13)).toBe('1 PM')
  })

  it('rotates weekday labels to Sunday-first', () => {
    expect(WEEKDAY_LABELS[0]).toBe('Sun')
    expect(WEEKDAY_LABELS).toHaveLength(7)
  })
})

describe('timeToOffset', () => {
  it('maps a moment in the day to a pixel offset from the slots top', () => {
    expect(timeToOffset(new Date(2026, 5, 10, 0, 0))).toBe(0)
    expect(timeToOffset(new Date(2026, 5, 10, 1, 0))).toBe(TIME_SLOT_HEIGHT)
    expect(timeToOffset(new Date(2026, 5, 10, 6, 30))).toBe(6.5 * TIME_SLOT_HEIGHT)
    expect(timeToOffset(new Date(2026, 5, 10, 23, 0))).toBe(23 * TIME_SLOT_HEIGHT)
  })
})

describe('layoutColumn', () => {
  const at = (h: number, m: number) => ({ start: new Date(2026, 5, 15, h, m) })

  it('keeps non-overlapping events full width in a single lane', () => {
    const placed = layoutColumn([at(9, 0), at(11, 0)], EVENT_CHIP_HEIGHT)
    expect(placed.map((p) => ({ lane: p.lane, lanes: p.lanes }))).toEqual([
      { lane: 0, lanes: 1 },
      { lane: 0, lanes: 1 },
    ])
  })

  it('splits events within one pill-height of each other into side-by-side lanes', () => {
    const placed = layoutColumn([at(9, 0), at(9, 10)], EVENT_CHIP_HEIGHT)
    expect(placed.map((p) => ({ lane: p.lane, lanes: p.lanes }))).toEqual([
      { lane: 0, lanes: 2 },
      { lane: 1, lanes: 2 },
    ])
  })

  it('reuses a freed lane after the overlap clears and resets the cluster', () => {
    const placed = layoutColumn([at(9, 0), at(9, 10), at(12, 0)], EVENT_CHIP_HEIGHT)
    expect(placed.map((p) => ({ lane: p.lane, lanes: p.lanes }))).toEqual([
      { lane: 0, lanes: 2 },
      { lane: 1, lanes: 2 },
      { lane: 0, lanes: 1 },
    ])
  })

  it('sorts by start time before assigning lanes', () => {
    const placed = layoutColumn([at(9, 10), at(9, 0)], EVENT_CHIP_HEIGHT)
    expect(placed[0].item).toEqual(at(9, 0))
    expect(placed[1].item).toEqual(at(9, 10))
  })
})
