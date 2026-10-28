import { describe, expect, it } from 'vitest'
import { outlookCalendarCreateEventTool } from '@/tools/outlook/calendar_create_event'
import { outlookCalendarListEventsTool } from '@/tools/outlook/calendar_list_events'
import { outlookCalendarRespondTool } from '@/tools/outlook/calendar_respond'
import { outlookCalendarUpdateEventTool } from '@/tools/outlook/calendar_update_event'

describe('outlook calendar tools', () => {
  it('scopes to a selected calendar, treats a blank pick as the default calendar, and rejects path ids', () => {
    const listUrl = outlookCalendarListEventsTool.request.url as (p: unknown) => string
    const window = {
      accessToken: 't',
      startDateTime: '2025-06-03T00:00:00Z',
      endDateTime: '2025-06-10T00:00:00Z',
    }

    expect(listUrl({ ...window, calendarId: 'AAMk=' })).toContain(
      '/v1.0/me/calendars/AAMk%3D/calendarView?'
    )
    expect(listUrl({ ...window, calendarId: '  ' })).toContain('/v1.0/me/calendarView?')
    expect(() => listUrl({ ...window, calendarId: '..' })).toThrow()
  })

  it('encodes a Graph id containing a slash instead of rejecting it', () => {
    const listUrl = outlookCalendarListEventsTool.request.url as (p: unknown) => string
    expect(
      listUrl({
        accessToken: 't',
        startDateTime: '2025-06-03T00:00:00Z',
        endDateTime: '2025-06-10T00:00:00Z',
        calendarId: 'AAMk/AB=',
      })
    ).toContain('/v1.0/me/calendars/AAMk%2FAB%3D/calendarView?')
  })

  it('treats date-only bounds as an all-day event even without the flag', () => {
    const createBody = outlookCalendarCreateEventTool.request.body as (
      p: unknown
    ) => Record<string, unknown>
    // Date-only carries no time, so this must not become a zero-length 00:00->00:00 window.
    const created = createBody({
      accessToken: 't',
      subject: 'Company holiday',
      startDateTime: '2025-06-03',
      endDateTime: '2025-06-03',
    })
    expect(created.isAllDay).toBe(true)
    expect(created.start).toEqual({ dateTime: '2025-06-03T00:00:00', timeZone: 'UTC' })
    expect(created.end).toEqual({ dateTime: '2025-06-04T00:00:00', timeZone: 'UTC' })

    const updateBody = outlookCalendarUpdateEventTool.request.body as (
      p: unknown
    ) => Record<string, unknown>
    const updated = updateBody({
      accessToken: 't',
      eventId: 'e1',
      startDateTime: '2025-06-03',
      endDateTime: '2025-06-05',
    })
    expect(updated.isAllDay).toBe(true)
    expect(updated.start).toEqual({ dateTime: '2025-06-03T00:00:00', timeZone: 'UTC' })
    expect(updated.end).toEqual({ dateTime: '2025-06-05T00:00:00', timeZone: 'UTC' })

    // A timed bound stays timed.
    const timed = createBody({
      accessToken: 't',
      subject: 'Sync',
      startDateTime: '2025-06-03T10:00:00Z',
      endDateTime: '2025-06-03T11:00:00Z',
    })
    expect(timed.isAllDay).toBeUndefined()

    // Mixed date-only + timed is a timed event starting at midnight, not all-day.
    const mixed = createBody({
      accessToken: 't',
      subject: 'Sync',
      startDateTime: '2025-06-03',
      endDateTime: '2025-06-03T11:00:00Z',
    })
    expect(mixed.isAllDay).toBeUndefined()
  })

  it('promotes date-only bounds even when isAllDay is explicitly false', () => {
    // The block always sends isAllDay for create, so an untouched All Day switch arrives
    // as `false`. Date-only bounds have no time, so honoring that false would emit a
    // zero-length midnight window — the shape wins over the flag, by design.
    const createBody = outlookCalendarCreateEventTool.request.body as (
      p: unknown
    ) => Record<string, unknown>
    const created = createBody({
      accessToken: 't',
      subject: 'Company holiday',
      startDateTime: '2025-06-03',
      endDateTime: '2025-06-03',
      isAllDay: false,
    })
    expect(created.isAllDay).toBe(true)
    expect(created.end).toEqual({ dateTime: '2025-06-04T00:00:00', timeZone: 'UTC' })

    const updateBody = outlookCalendarUpdateEventTool.request.body as (
      p: unknown
    ) => Record<string, unknown>
    const updated = updateBody({
      accessToken: 't',
      eventId: 'e1',
      startDateTime: '2025-06-03',
      endDateTime: '2025-06-04',
      isAllDay: false,
    })
    expect(updated.isAllDay).toBe(true)
  })

  it('does not promote a lone date-only bound on update', () => {
    const body = outlookCalendarUpdateEventTool.request.body as (
      p: unknown
    ) => Record<string, unknown>
    // Moving only the start of an existing timed/multi-day event must not collapse it into
    // a one-day all-day event: the other bound is left untouched for Graph to preserve.
    const movedStart = body({ accessToken: 't', eventId: 'e1', startDateTime: '2025-06-10' })
    expect(movedStart.isAllDay).toBeUndefined()
    expect(movedStart.start).toEqual({ dateTime: '2025-06-10T00:00:00', timeZone: 'UTC' })
    expect('end' in movedStart).toBe(false)

    const movedEnd = body({ accessToken: 't', eventId: 'e1', endDateTime: '2025-06-12' })
    expect(movedEnd.isAllDay).toBeUndefined()
    expect('start' in movedEnd).toBe(false)

    // An explicit isAllDay:true is stated intent, so deriving the missing bound is allowed.
    const explicit = body({
      accessToken: 't',
      eventId: 'e1',
      isAllDay: true,
      startDateTime: '2025-06-10',
    })
    expect(explicit.isAllDay).toBe(true)
    expect(explicit.end).toEqual({ dateTime: '2025-06-11T00:00:00', timeZone: 'UTC' })
  })

  it('rejects an all-day conversion that supplies no bounds', () => {
    const body = outlookCalendarUpdateEventTool.request.body as (
      p: unknown
    ) => Record<string, unknown>
    // Graph needs midnight bounds; they cannot be derived from a partial update.
    expect(() => body({ accessToken: 't', eventId: 'e1', isAllDay: true })).toThrow(
      /requires startDateTime/
    )
    // Turning all-day off without bounds is still a valid partial update.
    expect(body({ accessToken: 't', eventId: 'e1', isAllDay: false })).toEqual({ isAllDay: false })
  })

  it('normalizes an all-day update when only one bound is supplied', () => {
    const body = outlookCalendarUpdateEventTool.request.body as (
      p: unknown
    ) => Record<string, unknown>
    const built = body({
      accessToken: 't',
      eventId: 'e1',
      isAllDay: true,
      startDateTime: '2025-06-03T09:30:00Z',
    })
    // Both bounds must be midnight with an exclusive end day, or Graph 400s the PATCH.
    expect(built.start).toEqual({ dateTime: '2025-06-03T00:00:00', timeZone: 'UTC' })
    expect(built.end).toEqual({ dateTime: '2025-06-04T00:00:00', timeZone: 'UTC' })
    expect(built.isAllDay).toBe(true)
  })

  it('rejects a pageToken that is not a Graph event-collection nextLink', () => {
    const url = outlookCalendarListEventsTool.request.url as (p: unknown) => string
    expect(() => url({ accessToken: 't', pageToken: 'https://evil.example.com/steal' })).toThrow(
      /Microsoft Graph/
    )
    // A Graph origin alone is not enough: the bearer must not be replayed to another endpoint.
    expect(() =>
      url({ accessToken: 't', pageToken: 'https://graph.microsoft.com/v1.0/me/messages' })
    ).toThrow(/calendarView/)
  })

  it('rejects an invalid respond responseType', () => {
    const url = outlookCalendarRespondTool.request.url as (p: unknown) => string
    expect(() => url({ accessToken: 't', eventId: 'e1', responseType: 'maybe' })).toThrow(
      /Invalid responseType/
    )
  })

  it('requires both window bounds unless paging with a pageToken', () => {
    const url = outlookCalendarListEventsTool.request.url as (p: unknown) => string
    // Paging supplies only the token: the window is already baked into the nextLink.
    const nextLink =
      'https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=2025-06-03T00%3A00%3A00Z&endDateTime=2025-06-10T00%3A00%3A00Z&%24skip=10'
    expect(url({ accessToken: 't', pageToken: nextLink })).toBe(nextLink)
    expect(() => url({ accessToken: 't', startDateTime: '2025-06-03T00:00:00Z' })).toThrow(
      /startDateTime and endDateTime are required/
    )
    expect(() => url({ accessToken: 't' })).toThrow(/startDateTime and endDateTime are required/)
  })

  it('sends a stable transactionId so a retried create cannot duplicate the event', () => {
    const body = outlookCalendarCreateEventTool.request.body as (
      p: unknown
    ) => Record<string, unknown>
    const params = {
      accessToken: 't',
      subject: 'Sync',
      startDateTime: '2025-06-03T10:00:00Z',
      endDateTime: '2025-06-03T11:00:00Z',
    }
    const first = body(params)
    expect(typeof first.transactionId).toBe('string')
    expect(first.transactionId).toBeTruthy()

    // Distinct executions must not share an id, or Graph would discard a genuine
    // second event as a duplicate. (Retries reuse one body, built once per execution.)
    expect(body(params).transactionId).not.toBe(first.transactionId)
  })
})
