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
    // We intentionally do NOT set onlineMeetingProvider so Graph uses the mailbox
    // default (Teams on work/school accounts) instead of hardcoding a work-only value.
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

  it('omits the comment key when empty so sendResponse=false is accepted by Graph', () => {
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
