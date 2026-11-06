/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  layoutDay,
  MAX_MEETING_LANES,
  maxLanesForWidth,
} from '@/platform/embedded/app/(shell)/home/_components/calendar/day-layout'
import type { CalendarMeeting } from '@/platform/shared/home'

function meeting(id: string, startMinute: number, duration: number): CalendarMeeting {
  return { id, title: id, startMinute, duration, people: [] }
}

const at = (hour: number, minute = 0) => hour * 60 + minute

function layout(meetings: CalendarMeeting[], maxLanes = MAX_MEETING_LANES) {
  const { cards, overflows } = layoutDay(meetings, maxLanes)
  return {
    cards,
    overflows,
    card: (id: string) => {
      const found = cards.find((card) => card.meeting.id === id)
      if (!found) throw new Error(`${id} has no card`)
      return found
    },
  }
}

function collisions(meetings: CalendarMeeting[], maxLanes = MAX_MEETING_LANES) {
  const { cards } = layoutDay(meetings, maxLanes)
  return cards.flatMap((left, index) =>
    cards
      .slice(index + 1)
      .filter(
        (right) =>
          left.lane === right.lane &&
          left.startMinute < right.endMinute &&
          right.startMinute < left.endMinute
      )
      .map((right) => `${left.meeting.id}/${right.meeting.id}`)
  )
}

describe('a card never lands on another', () => {
  it('keeps every card of a four-way overlap apart, past the lanes the width can show', () => {
    const four = ['a', 'b', 'c', 'd'].map((id) => meeting(id, at(13), 60))
    expect(collisions(four)).toEqual([])
  })

  it('counts a short meeting by the height it is drawn at, not its duration', () => {
    const short = [meeting('a', at(10), 20), meeting('b', at(10, 20), 20)]
    expect(collisions(short)).toEqual([])
    const { card } = layout(short)
    expect(card('a').lanes).toBe(2)
    expect(card('b').lanes).toBe(2)
  })

  it('treats a run of very short meetings the same way', () => {
    const run = [0, 5, 10, 15, 20, 25, 30, 35].map((offset) =>
      meeting(`m${offset}`, at(9, offset), 5)
    )
    expect(collisions(run)).toEqual([])
  })

  it('holds for meetings given in any order', () => {
    const shuffled = [
      meeting('late', at(14), 30),
      meeting('long', at(9), 180),
      meeting('short', at(10), 20),
      meeting('early', at(9), 30),
    ]
    expect(collisions(shuffled)).toEqual([])
  })
})

describe('a meeting ending as the next begins', () => {
  it('keeps each at full width, not side by side', () => {
    const { card } = layout([meeting('a', at(9, 30), 30), meeting('b', at(10), 30)])
    expect(card('a').lanes).toBe(1)
    expect(card('b').lanes).toBe(1)
  })
})

describe('what a card has room to say', () => {
  it('gives a 30-minute slot one line, since two do not fit its height', () => {
    expect(layout([meeting('a', at(9), 30)]).card('a').density).toBe('compact')
  })

  it('gives a 5-minute meeting the same single line', () => {
    expect(layout([meeting('a', at(9), 5)]).card('a').density).toBe('compact')
  })

  it('gives a 45-minute meeting two lines, as the design draws it', () => {
    expect(layout([meeting('a', at(9), 45)]).card('a').density).toBe('full')
  })
})

describe('more overlapping meetings than lanes', () => {
  const four = ['a', 'b', 'c', 'd'].map((id) => meeting(id, at(13), 60))

  it('keeps every meeting reachable, exactly once', () => {
    const { cards, overflows } = layout(four)
    const reached = [
      ...cards.map((card) => card.meeting.id),
      ...overflows.flatMap((overflow) => overflow.meetings.map(({ id }) => id)),
    ]
    expect([...reached].sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('reserves room for the affordance across the whole overlapping run', () => {
    const { cards, overflows } = layout(four)
    expect(overflows).toHaveLength(1)
    expect(cards.every((card) => card.reservesOverflow)).toBe(true)
  })

  it('reserves nothing for a run that fits', () => {
    const { cards, overflows } = layout(four.slice(0, 3))
    expect(overflows).toEqual([])
    expect(cards.some((card) => card.reservesOverflow)).toBe(false)
  })

  it('gives separate hidden groups separate affordances that do not overlap', () => {
    const { overflows } = layout([
      ...four,
      meeting('e', at(13), 240),
      meeting('f', at(13), 240),
      meeting('g', at(13), 240),
      meeting('h', at(16), 30),
      meeting('i', at(16), 30),
      meeting('j', at(16), 30),
      meeting('k', at(16), 30),
    ])
    const ordered = [...overflows].sort((left, right) => left.startMinute - right.startMinute)
    expect(ordered.length).toBeGreaterThan(1)
    for (const [index, overflow] of ordered.entries()) {
      const next = ordered[index + 1]
      if (next) expect(overflow.endMinute).toBeLessThanOrEqual(next.startMinute)
    }
  })

  it('moves to the affordance sooner when the width shows fewer lanes', () => {
    const { cards, overflows } = layout(four, 2)
    expect(cards).toHaveLength(2)
    expect(overflows.flatMap((overflow) => overflow.meetings)).toHaveLength(2)
  })

  it('still shows one card at the narrowest width', () => {
    expect(maxLanesForWidth(0)).toBe(1)
    expect(maxLanesForWidth(358)).toBeLessThan(MAX_MEETING_LANES)
    expect(maxLanesForWidth(500)).toBe(MAX_MEETING_LANES)
  })
})

describe('the edges of the day', () => {
  it('draws a zero-length meeting at the minimum, not as nothing', () => {
    const { card } = layout([meeting('a', at(9), 0)])
    expect(card('a').endMinute).toBeGreaterThan(card('a').startMinute)
  })

  it('never draws past midnight', () => {
    const late = [meeting('a', at(23, 50), 10), meeting('b', at(24), 0), meeting('c', at(23), 60)]
    const { cards } = layout(late)
    for (const card of cards) expect(card.endMinute).toBeLessThanOrEqual(at(24))
    expect(collisions(late)).toEqual([])
  })

  it('lets a long meeting and the short ones beside it share the width', () => {
    const { card } = layout([
      meeting('long', at(9), 180),
      meeting('a', at(9, 30), 30),
      meeting('b', at(11), 15),
    ])
    expect(card('long').lanes).toBe(2)
    expect(card('a').lane).not.toBe(card('long').lane)
    expect(card('b').lane).not.toBe(card('long').lane)
  })
})
