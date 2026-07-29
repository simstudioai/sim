/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { outlookCalendarCreateEventTool } from '@/tools/outlook/calendar_create_event'
import { outlookCalendarDeleteEventTool } from '@/tools/outlook/calendar_delete_event'
import { outlookCalendarGetEventTool } from '@/tools/outlook/calendar_get_event'
import { outlookCalendarListEventsTool } from '@/tools/outlook/calendar_list_events'
import { outlookCalendarRespondTool } from '@/tools/outlook/calendar_respond'
import { outlookCalendarUpdateEventTool } from '@/tools/outlook/calendar_update_event'

const tools = [
  outlookCalendarListEventsTool,
  outlookCalendarGetEventTool,
  outlookCalendarCreateEventTool,
  outlookCalendarUpdateEventTool,
  outlookCalendarDeleteEventTool,
  outlookCalendarRespondTool,
]

describe('outlook calendar tools', () => {
  it('every tool uses the outlook oauth provider and a snake_case id', () => {
    for (const tool of tools) {
      expect(tool.oauth).toEqual({ required: true, provider: 'outlook' })
      expect(tool.id).toMatch(/^outlook_calendar_[a-z_]+$/)
      expect(tool.version).toBe('1.0.0')
      expect(tool.outputs?.message).toBeDefined()
    }
  })

  it('exposes the expected tool ids', () => {
    expect(tools.map((t) => t.id)).toEqual([
      'outlook_calendar_list_events',
      'outlook_calendar_get_event',
      'outlook_calendar_create_event',
      'outlook_calendar_update_event',
      'outlook_calendar_delete_event',
      'outlook_calendar_respond',
    ])
  })

  it('builds a calendarView URL with the time window and paging', () => {
    const url = outlookCalendarListEventsTool.request.url as (p: unknown) => string
    const built = url({
      accessToken: 't',
      startDateTime: '2025-06-03T00:00:00Z',
      endDateTime: '2025-06-10T00:00:00Z',
      maxResults: 5,
    })
    expect(built).toContain('https://graph.microsoft.com/v1.0/me/calendarView')
    expect(built).toContain('startDateTime=2025-06-03T00%3A00%3A00Z')
    expect(built).toContain('%24top=5')
    expect(built).toContain('%24orderby=start%2FdateTime')

    // A Graph-origin nextLink page token is accepted.
    expect(url({ accessToken: 't', pageToken: 'https://graph.microsoft.com/next' })).toBe(
      'https://graph.microsoft.com/next'
    )
  })

  it('scopes list and create to a selected calendar, defaulting to the default calendar', () => {
    const listUrl = outlookCalendarListEventsTool.request.url as (p: unknown) => string
    const createUrl = outlookCalendarCreateEventTool.request.url as (p: unknown) => string
    const window = {
      accessToken: 't',
      startDateTime: '2025-06-03T00:00:00Z',
      endDateTime: '2025-06-10T00:00:00Z',
    }

    expect(listUrl(window)).toContain('/v1.0/me/calendarView?')
    expect(listUrl({ ...window, calendarId: 'AAMk=' })).toContain(
      '/v1.0/me/calendars/AAMk%3D/calendarView?'
    )
    // A blank pick means "default calendar", not a malformed /me/calendars// URL.
    expect(listUrl({ ...window, calendarId: '  ' })).toContain('/v1.0/me/calendarView?')

    expect(createUrl({ accessToken: 't' })).toBe('https://graph.microsoft.com/v1.0/me/events')
    expect(createUrl({ accessToken: 't', calendarId: 'AAMk=' })).toBe(
      'https://graph.microsoft.com/v1.0/me/calendars/AAMk%3D/events'
    )
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

  it('rejects a non-Graph pageToken so the bearer token cannot be exfiltrated', () => {
    const url = outlookCalendarListEventsTool.request.url as (p: unknown) => string
    expect(() => url({ accessToken: 't', pageToken: 'https://evil.example.com/steal' })).toThrow(
      /Microsoft Graph/
    )
  })

  it('builds an all-day create body with midnight bounds and an exclusive end day', () => {
    const body = outlookCalendarCreateEventTool.request.body as (
      p: unknown
    ) => Record<string, unknown>
    const built = body({
      accessToken: 't',
      subject: 'Offsite',
      startDateTime: '2025-06-03',
      endDateTime: '2025-06-03',
      isAllDay: true,
    })
    expect(built.isAllDay).toBe(true)
    expect(built.start).toEqual({ dateTime: '2025-06-03T00:00:00', timeZone: 'UTC' })
    expect(built.end).toEqual({ dateTime: '2025-06-04T00:00:00', timeZone: 'UTC' })
  })

  it('builds a create-event body with Graph datetime shape and attendees', () => {
    const body = outlookCalendarCreateEventTool.request.body as (
      p: unknown
    ) => Record<string, unknown>
    const built = body({
      accessToken: 't',
      subject: 'Sync',
      startDateTime: '2025-06-03T10:00:00-08:00',
      endDateTime: '2025-06-03T11:00:00-08:00',
      attendees: 'a@x.com, b@y.com',
      isOnlineMeeting: true,
    })
    expect(built.subject).toBe('Sync')
    expect(built.start).toEqual({ dateTime: '2025-06-03T18:00:00', timeZone: 'UTC' })
    expect(built.attendees).toHaveLength(2)
    expect(built.isOnlineMeeting).toBe(true)
    // onlineMeetingProvider is optional and pinning it would break mailboxes that
    // disallow that provider; isOnlineMeeting alone initializes the online meeting.
    expect('onlineMeetingProvider' in built).toBe(false)
  })

  it('rejects an invalid respond responseType', () => {
    const url = outlookCalendarRespondTool.request.url as (p: unknown) => string
    expect(() => url({ accessToken: 't', eventId: 'e1', responseType: 'maybe' })).toThrow(
      /Invalid responseType/
    )
    expect(url({ accessToken: 't', eventId: 'e1', responseType: 'accept' })).toBe(
      'https://graph.microsoft.com/v1.0/me/events/e1/accept'
    )
  })

  it('requires both window bounds unless paging with a pageToken', () => {
    const url = outlookCalendarListEventsTool.request.url as (p: unknown) => string
    // Paging supplies only the token: the window is already baked into the nextLink.
    expect(url({ accessToken: 't', pageToken: 'https://graph.microsoft.com/next' })).toBe(
      'https://graph.microsoft.com/next'
    )
    expect(() => url({ accessToken: 't', startDateTime: '2025-06-03T00:00:00Z' })).toThrow(
      /startDateTime and endDateTime are required/
    )
    expect(() => url({ accessToken: 't' })).toThrow(/startDateTime and endDateTime are required/)
  })

  it('omits the comment key when empty but keeps it alongside sendResponse=false', () => {
    const body = outlookCalendarRespondTool.request.body as (p: unknown) => Record<string, unknown>
    // Empty/whitespace comment with sendResponse off: comment must NOT be present.
    const noComment = body({
      eventId: 'e1',
      responseType: 'accept',
      sendResponse: false,
      comment: '',
    })
    expect(noComment).toEqual({ sendResponse: false })
    expect('comment' in noComment).toBe(false)

    const nullComment = body({ eventId: 'e1', responseType: 'decline', sendResponse: false })
    expect('comment' in nullComment).toBe(false)

    // A real comment with sendResponse=false is valid: Graph's documented 400s for
    // accept/decline are both about proposedNewTime, which we never send.
    expect(
      body({ eventId: 'e1', responseType: 'decline', sendResponse: false, comment: 'Conflict' })
    ).toEqual({ sendResponse: false, comment: 'Conflict' })

    // A real comment is included, and sendResponse defaults to true.
    const withComment = body({ eventId: 'e1', responseType: 'accept', comment: 'See you there' })
    expect(withComment).toEqual({ sendResponse: true, comment: 'See you there' })
  })

  it('enables retry with backoff on every calendar tool (429/mailbox concurrency)', () => {
    for (const tool of tools) {
      expect(tool.request.retry?.enabled).toBe(true)
      // false so POST/PATCH (create/update/respond) also retry on a 429 throttle.
      expect(tool.request.retry?.retryIdempotentOnly).toBe(false)
    }
  })
})
