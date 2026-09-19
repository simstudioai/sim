/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { respondTool, respondV2Tool } from '@/tools/google_calendar/respond'
import type { GoogleCalendarRespondParams } from '@/tools/google_calendar/types'

const baseParams: GoogleCalendarRespondParams = {
  accessToken: 'token',
  calendarId: 'primary',
  eventId: 'series123_20260921T170000Z',
  responseStatus: 'accepted',
}

function eventWith(selfStatus: string, selfComment?: string) {
  return {
    id: 'series123_20260921T170000Z',
    status: 'confirmed',
    htmlLink: 'https://calendar.google.com/event?eid=abc',
    summary: 'Monday eng',
    recurringEventId: 'series123',
    start: { dateTime: '2026-09-21T10:00:00-07:00' },
    end: { dateTime: '2026-09-21T10:30:00-07:00' },
    organizer: { email: 'lead@example.com' },
    attendees: [
      { email: 'lead@example.com', organizer: true, responseStatus: 'accepted' },
      { email: 'me@example.com', self: true, responseStatus: selfStatus, comment: selfComment },
      { email: 'peer@example.com', responseStatus: 'tentative' },
    ],
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('google_calendar_respond', () => {
  it('reads the event occurrence it is given', () => {
    const url = (respondTool.request.url as (p: GoogleCalendarRespondParams) => string)(baseParams)
    expect(url).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events/series123_20260921T170000Z'
    )
    expect(respondTool.request.method).toBe('GET')
  })

  it('patches only the self attendee with attendeesOmitted and verifies the result', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(eventWith('accepted', 'See you')))
    vi.stubGlobal('fetch', fetchMock)

    const result = await respondV2Tool.transformResponse!(jsonResponse(eventWith('needsAction')), {
      ...baseParams,
      comment: '  See you  ',
      sendUpdates: 'all',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events/series123_20260921T170000Z?sendUpdates=all'
    )
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({
      attendeesOmitted: true,
      attendees: [{ email: 'me@example.com', responseStatus: 'accepted', comment: 'See you' }],
    })
    expect(result.output).toMatchObject({
      id: 'series123_20260921T170000Z',
      responseStatus: 'accepted',
      comment: 'See you',
    })
  })

  it('omits sendUpdates and comment when not provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(eventWith('declined')))
    vi.stubGlobal('fetch', fetchMock)

    const result = await respondTool.transformResponse!(jsonResponse(eventWith('needsAction')), {
      ...baseParams,
      responseStatus: 'declined',
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).not.toContain('?')
    expect(JSON.parse(init.body).attendees).toEqual([
      { email: 'me@example.com', responseStatus: 'declined' },
    ])
    expect(result.output.content).toBe('Response to "Monday eng" set to declined')
  })

  it('fails when the calendar is not an attendee', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const event = { ...eventWith('needsAction'), attendees: [{ email: 'x@example.com' }] }

    await expect(respondTool.transformResponse!(jsonResponse(event), baseParams)).rejects.toThrow(
      /not an attendee/
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects an unsupported response status before writing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      respondTool.transformResponse!(jsonResponse(eventWith('needsAction')), {
        ...baseParams,
        responseStatus: 'needsAction' as GoogleCalendarRespondParams['responseStatus'],
      })
    ).rejects.toThrow(/Invalid response status/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces the Google error when the patch is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'Forbidden' } }, 403))
    )

    await expect(
      respondTool.transformResponse!(jsonResponse(eventWith('needsAction')), baseParams)
    ).rejects.toThrow('Forbidden')
  })

  it('fails when Google does not reflect the new response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(eventWith('needsAction'))))

    await expect(
      respondTool.transformResponse!(jsonResponse(eventWith('needsAction')), baseParams)
    ).rejects.toThrow(/did not apply the response/)
  })
})
