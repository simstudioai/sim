/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  buildAllDayRange,
  buildGraphEventDateTime,
  DEFAULT_OUTLOOK_TIME_ZONE,
  flattenGraphEvent,
  normalizeAttendees,
} from '@/tools/outlook/calendar-utils'
import type { GraphEvent } from '@/tools/outlook/types'

describe('buildGraphEventDateTime', () => {
  it('treats a date-only value as an all-day midnight start in the given zone', () => {
    expect(buildGraphEventDateTime('2025-06-03', 'America/Los_Angeles')).toEqual({
      dateTime: '2025-06-03T00:00:00',
      timeZone: 'America/Los_Angeles',
    })
  })

  it('defaults the zone to UTC when none is given for a date-only value', () => {
    expect(buildGraphEventDateTime('2025-06-03')).toEqual({
      dateTime: '2025-06-03T00:00:00',
      timeZone: DEFAULT_OUTLOOK_TIME_ZONE,
    })
  })

  it('keeps a naive datetime as wall-clock time in the provided zone', () => {
    expect(buildGraphEventDateTime('2025-06-03T10:00:00', 'America/New_York')).toEqual({
      dateTime: '2025-06-03T10:00:00',
      timeZone: 'America/New_York',
    })
  })

  it('converts a Z-suffixed datetime to an offset-less UTC value', () => {
    expect(buildGraphEventDateTime('2025-06-03T10:00:00Z')).toEqual({
      dateTime: '2025-06-03T10:00:00',
      timeZone: 'UTC',
    })
  })

  it('converts an offset datetime to the equivalent UTC instant', () => {
    // 10:00 at -08:00 is 18:00 UTC
    expect(buildGraphEventDateTime('2025-06-03T10:00:00-08:00')).toEqual({
      dateTime: '2025-06-03T18:00:00',
      timeZone: 'UTC',
    })
  })
})

describe('buildAllDayRange', () => {
  it('advances a same-day end to the next day (exclusive end) at midnight', () => {
    expect(buildAllDayRange('2025-06-03', '2025-06-03', 'America/Los_Angeles')).toEqual({
      start: { dateTime: '2025-06-03T00:00:00', timeZone: 'America/Los_Angeles' },
      end: { dateTime: '2025-06-04T00:00:00', timeZone: 'America/Los_Angeles' },
    })
  })

  it('preserves an already-multi-day range and strips any time component', () => {
    expect(buildAllDayRange('2025-06-03T09:30:00', '2025-06-05T14:00:00')).toEqual({
      start: { dateTime: '2025-06-03T00:00:00', timeZone: DEFAULT_OUTLOOK_TIME_ZONE },
      end: { dateTime: '2025-06-05T00:00:00', timeZone: DEFAULT_OUTLOOK_TIME_ZONE },
    })
  })

  it('advances across a month boundary', () => {
    expect(buildAllDayRange('2025-06-30', '2025-06-30').end.dateTime).toBe('2025-07-01T00:00:00')
  })
})

describe('normalizeAttendees', () => {
  it('returns an empty array for undefined', () => {
    expect(normalizeAttendees(undefined)).toEqual([])
  })

  it('splits a comma-separated string into required attendees', () => {
    expect(normalizeAttendees('a@x.com, b@y.com')).toEqual([
      { emailAddress: { address: 'a@x.com' }, type: 'required' },
      { emailAddress: { address: 'b@y.com' }, type: 'required' },
    ])
  })

  it('accepts an array and honors a custom type', () => {
    expect(normalizeAttendees(['a@x.com'], 'optional')).toEqual([
      { emailAddress: { address: 'a@x.com' }, type: 'optional' },
    ])
  })

  it('drops empty entries', () => {
    expect(normalizeAttendees('a@x.com,,\n , b@y.com')).toEqual([
      { emailAddress: { address: 'a@x.com' }, type: 'required' },
      { emailAddress: { address: 'b@y.com' }, type: 'required' },
    ])
  })
})

describe('flattenGraphEvent', () => {
  it('flattens the Graph event into editor-friendly fields', () => {
    const event: GraphEvent = {
      id: 'evt-1',
      subject: 'Standup',
      bodyPreview: 'Daily sync',
      start: { dateTime: '2025-06-03T10:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2025-06-03T10:30:00.0000000', timeZone: 'UTC' },
      isAllDay: false,
      webLink: 'https://outlook.office.com/evt-1',
      location: { displayName: 'Room 1' },
      organizer: { emailAddress: { name: 'Alice', address: 'alice@x.com' } },
      onlineMeeting: { joinUrl: 'https://teams.example/join' },
      attendees: [
        {
          type: 'required',
          status: { response: 'accepted' },
          emailAddress: { name: 'Bob', address: 'bob@y.com' },
        },
      ],
    }

    expect(flattenGraphEvent(event)).toEqual({
      id: 'evt-1',
      subject: 'Standup',
      bodyPreview: 'Daily sync',
      start: { dateTime: '2025-06-03T10:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2025-06-03T10:30:00.0000000', timeZone: 'UTC' },
      isAllDay: false,
      location: 'Room 1',
      organizer: { name: 'Alice', address: 'alice@x.com' },
      attendees: [{ name: 'Bob', address: 'bob@y.com', type: 'required', response: 'accepted' }],
      onlineMeeting: { joinUrl: 'https://teams.example/join' },
      webLink: 'https://outlook.office.com/evt-1',
    })
  })

  it('returns a null onlineMeeting when the event has no join URL', () => {
    const event: GraphEvent = { id: 'evt-2' }
    const flattened = flattenGraphEvent(event)
    expect(flattened.onlineMeeting).toBeNull()
    expect(flattened.attendees).toEqual([])
  })
})
