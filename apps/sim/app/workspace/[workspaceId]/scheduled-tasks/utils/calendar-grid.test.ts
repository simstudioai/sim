import { describe, expect, it } from 'vitest'
import {
  EVENT_CHIP_HEIGHT,
  layoutColumn,
  visibleRange,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/calendar-grid'

// June 10, 2026 is a Wednesday. June 1, 2026 is a Monday.
const ANCHOR = new Date(2026, 5, 10)

describe('visibleRange', () => {
  it('pads the rendered span by a day each side to cover timezone offset slop', () => {
    // Week of Jun 7–13, 2026 (Sun–Sat); padded to Jun 6 → Jun 14.
    const { start, end } = visibleRange('week', ANCHOR)
    expect(start).toEqual(new Date(2026, 5, 6))
    expect(end.getDate()).toBe(14)
  })
})

describe('layoutColumn', () => {
  const at = (h: number, m: number) => ({ start: new Date(2026, 5, 15, h, m) })

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
