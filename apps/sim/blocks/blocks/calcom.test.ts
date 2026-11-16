import { describe, expect, it } from 'vitest'
import { CalComBlock } from '@/blocks/blocks/calcom'
import type { BlockToolParamsContext } from '@/blocks/types'

function mapParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  const mapper = CalComBlock.tools.config?.params
  if (!mapper) throw new Error('Cal.com block has no params mapper')
  return mapper(params, context)
}

/** What the tool receives: the mapper output spread over the params it was given. */
function sentParams(params: Record<string, unknown>, context?: BlockToolParamsContext) {
  return { ...params, ...mapParams(params, context) }
}

describe('Cal.com create booking on a tool call', () => {
  it('lets pinned attendee fields win over the model attendee and keeps the rest', () => {
    const sent = sentParams(
      {
        attendeeName: 'Pinned Name',
        attendeeTimeZone: 'Europe/London',
        attendee: { name: 'Model Name', email: 'model@x.com', timeZone: 'UTC' },
        eventTypeId: 123,
        start: '2026-01-15T10:00:00Z',
      },
      { operation: 'calcom_create_booking' }
    )

    expect(sent.attendee).toEqual({
      name: 'Pinned Name',
      email: 'model@x.com',
      timeZone: 'Europe/London',
    })
    expect(sent.eventTypeId).toBe(123)
  })

  it('splits pinned comma-separated guests into an array', () => {
    const sent = sentParams(
      { guests: 'a@x.com, b@y.com', attendee: { name: 'A', timeZone: 'UTC' } },
      { operation: 'calcom_create_booking' }
    )
    expect(sent.guests).toEqual(['a@x.com', 'b@y.com'])
  })
})

describe('Cal.com create booking on the canvas', () => {
  it('accepts guests that already resolved to an array', () => {
    const sent = sentParams({
      operation: 'calcom_create_booking',
      attendeeName: 'A',
      attendeeTimeZone: 'UTC',
      guests: ['a@x.com'],
    })
    expect(sent.guests).toEqual(['a@x.com'])
  })
})

describe('Cal.com list bookings', () => {
  it('sends the pinned status instead of the model status on a tool call', () => {
    const sent = sentParams(
      { bookingStatus: 'past', status: 'upcoming' },
      { operation: 'calcom_list_bookings' }
    )
    expect(sent.status).toBe('past')
  })

  it('keeps the model status and attendee filter when nothing is pinned', () => {
    const sent = sentParams(
      { status: 'upcoming', attendeeEmail: 'a@x.com', take: 5 },
      { operation: 'calcom_list_bookings' }
    )
    expect(sent.status).toBe('upcoming')
    expect(sent.attendeeEmail).toBe('a@x.com')
    expect(sent.take).toBe(5)
  })

  it('does not filter by an attendee email left over from Create Booking on the canvas', () => {
    const sent = sentParams({
      operation: 'calcom_list_bookings',
      attendeeEmail: 'stale@x.com',
      take: '10',
    })
    expect(sent.attendeeEmail).toBeUndefined()
    expect(sent.take).toBe(10)
  })

  it.each([null, ''])('drops blank advanced limit and offset (%j) on the canvas', (blank) => {
    const sent = sentParams({ operation: 'calcom_list_bookings', take: blank, skip: blank })
    expect(sent.take).toBeUndefined()
    expect(sent.skip).toBeUndefined()
  })
})

describe('Cal.com event type id on a tool call', () => {
  it('uses the event type picked in the tool row', () => {
    const sent = sentParams(
      { eventTypeIdParam: '42', eventTypeId: 7 },
      { operation: 'calcom_get_event_type' }
    )
    expect(sent.eventTypeId).toBe(42)
  })

  it('keeps the model event type id and fields on an update with nothing pinned', () => {
    const sent = sentParams(
      { eventTypeId: 7, lengthInMinutes: 45, scheduleId: 3 },
      { operation: 'calcom_update_event_type' }
    )
    expect(sent).toMatchObject({ eventTypeId: 7, lengthInMinutes: 45, scheduleId: 3 })
  })
})
