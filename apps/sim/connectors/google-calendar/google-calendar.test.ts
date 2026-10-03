import { jsonResponse } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { googleCalendarConnector } from '@/connectors/google-calendar/google-calendar'
import { PER_MEMBER_LISTING_CONTEXT } from '@/connectors/utils'

const ORGANIZER_EMAIL = 'organizer@example.com'
const ATTENDEE_EMAIL = 'attendee@example.com'
const ATTENDEE_NAME = 'Ada Lovelace'

const EVENT = {
  id: 'evt-1',
  status: 'confirmed',
  summary: 'Quarterly sync',
  description: 'Agenda attached',
  location: 'Room 4',
  htmlLink: 'https://calendar.google.com/event?eid=evt-1',
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-02T00:00:00Z',
  start: { dateTime: '2026-02-01T10:00:00Z', timeZone: 'UTC' },
  end: { dateTime: '2026-02-01T11:00:00Z', timeZone: 'UTC' },
  organizer: { email: ORGANIZER_EMAIL, displayName: 'Grace Hopper' },
  attendees: [
    { email: ATTENDEE_EMAIL, displayName: ATTENDEE_NAME },
    { email: 'second@example.com' },
    { email: 'room@resource.calendar.google.com', resource: true },
  ],
}

const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    if (url.includes('/events?')) return jsonResponse({ items: [EVENT] })
    if (url.includes('/events/')) return jsonResponse(EVENT)
    throw new Error(`Unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Google Calendar Search isolation', () => {
  const alice = { ...PER_MEMBER_LISTING_CONTEXT, memberId: 'alice' }
  const bob = { ...PER_MEMBER_LISTING_CONTEXT, memberId: 'bob' }

  it('requests reconnection on rejected credentials while retaining scope and quota errors', async () => {
    for (const status of [401, 403, 404]) {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: status } }, status))
      const error = await googleCalendarConnector
        .listDocuments('token', {}, undefined, alice)
        .catch((caught: unknown) => caught)
      expect(googleCalendarConnector.isCredentialInvalidError?.(error)).toBe(status === 401)
      expect(googleCalendarConnector.isListingScopeUnavailableError?.(error)).toBe(status === 404)
    }
    const doc = (await googleCalendarConnector.listDocuments('token', {}, undefined, alice))
      .documents[0]
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: { code: 401 } }, 401))
    const error = await googleCalendarConnector
      .getDocument('token', {}, doc.externalId, alice)
      .catch((caught: unknown) => caught)
    expect(googleCalendarConnector.isCredentialInvalidError?.(error)).toBe(true)
  })

  it.each(['1e3', '0x10', '+5'])(
    'rejects noncanonical numeric notation before sync (%s)',
    async (maxEvents) => {
      expect(await googleCalendarConnector.validateConfig('token', { maxEvents })).toEqual({
        valid: false,
        error: 'Max events must be a positive whole number',
      })
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('keeps the same event separate for two readers and two calendars', async () => {
    const read = async (context: Record<string, unknown>, calendarId: string) =>
      (await googleCalendarConnector.listDocuments('token', { calendarId }, undefined, context))
        .documents[0]
    const own = await read(alice, 'primary')
    const other = await read(bob, 'primary')
    const team = await read(alice, 'team@example.com')
    expect(new Set([own.externalId, other.externalId, team.externalId]).size).toBe(3)
    expect((await listOne({})).externalId).toBe(EVENT.id)
  })

  it('rehydrates only the same member and configured calendar', async () => {
    const listing = await googleCalendarConnector.listDocuments('token', {}, undefined, alice)
    const doc = listing.documents[0]
    const full = await googleCalendarConnector.getDocument('token', {}, doc.externalId, alice)
    expect(full?.externalId).toBe(doc.externalId)
    expect(full?.contentHash).toBe(doc.contentHash)
    fetchMock.mockClear()
    expect(await googleCalendarConnector.getDocument('token', {}, doc.externalId, bob)).toBeNull()
    expect(await googleCalendarConnector.getDocument('token', {}, EVENT.id, alice)).toBeNull()
    expect(
      await googleCalendarConnector.getDocument(
        'token',
        { calendarId: 'other@example.com' },
        doc.externalId,
        alice
      )
    ).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('changes the indexed representation when access hides details without editing the event', async () => {
    const original = await googleCalendarConnector.listDocuments('token', {}, undefined, alice)
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        accessRole: 'reader',
        items: [{ ...EVENT, description: undefined, organizer: undefined, attendees: undefined }],
      })
    )
    const restricted = await googleCalendarConnector.listDocuments('token', {}, undefined, alice)
    expect(restricted.documents[0].externalId).toBe(original.documents[0].externalId)
    expect(restricted.documents[0].contentHash).not.toBe(original.documents[0].contentHash)
    expect(restricted.documents[0].content).not.toContain(EVENT.description)
    expect(restricted.documents[0].content).not.toContain(ORGANIZER_EMAIL)
    expect(restricted.documents[0].metadata?.organizer).toBe('')
  })

  it('withdraws a free/busy time block that carries no title or description', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        accessRole: 'freeBusyReader',
        items: [{ id: EVENT.id, updated: EVENT.updated, start: EVENT.start, end: EVENT.end }],
      })
    )
    const result = await googleCalendarConnector.listDocuments('token', {}, undefined, alice)
    expect(result).toMatchObject({ documents: [], hasMore: false })
  })

  it('withdraws cancelled events, including instances of recurring events', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ items: [{ ...EVENT, status: 'cancelled', recurringEventId: 'series' }] })
    )
    const result = await googleCalendarConnector.listDocuments('token', {}, undefined, alice)
    expect(result).toMatchObject({ documents: [], hasMore: false })
  })
})

async function listOne(sourceConfig: Record<string, unknown>) {
  const result = await googleCalendarConnector.listDocuments('token', sourceConfig)
  expect(result.documents).toHaveLength(1)
  return result.documents[0]
}

describe('google-calendar listDocuments with a calendar the caller cannot reach', () => {
  function mockCalendars(unreachable: string) {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes(`/calendars/${unreachable}/events?`)) {
        return jsonResponse({ error: { code: 404 } }, 404)
      }
      if (url.includes('/events?')) return jsonResponse({ items: [EVENT] })
      throw new Error(`Unexpected fetch: ${url}`)
    })
  }

  it("skips only the unreachable calendar under a member's own token", async () => {
    mockCalendars('alpha')
    const sourceConfig = { calendarId: 'alpha,beta' }
    const syncContext: Record<string, unknown> = {
      ...PER_MEMBER_LISTING_CONTEXT,
      memberId: 'member-a',
    }

    const first = await googleCalendarConnector.listDocuments(
      'token',
      sourceConfig,
      undefined,
      syncContext
    )
    expect(first.documents).toHaveLength(0)
    expect(first.hasMore).toBe(true)
    expect(JSON.parse(first.nextCursor ?? '{}')).toMatchObject({ calendarIndex: 1 })

    const second = await googleCalendarConnector.listDocuments(
      'token',
      sourceConfig,
      first.nextCursor,
      syncContext
    )
    expect(second.documents).toHaveLength(1)
    expect(second.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('still fails the sync under a shared credential rather than dropping the calendar', async () => {
    mockCalendars('alpha')
    await expect(
      googleCalendarConnector.listDocuments('token', { calendarId: 'alpha,beta' }, undefined, {})
    ).rejects.toThrow('Failed to list Google Calendar events: 404')
  })
})

describe('google-calendar attendee PII opt-out', () => {
  it('omits every attendee/organizer identifier from content and tags when off', async () => {
    const doc = await listOne({ includeAttendees: 'false' })

    const serialized = JSON.stringify(doc)
    for (const identifier of [
      ORGANIZER_EMAIL,
      ATTENDEE_EMAIL,
      ATTENDEE_NAME,
      'second@example.com',
      'Grace Hopper',
    ]) {
      expect(serialized).not.toContain(identifier)
    }
    expect(doc.content).not.toContain('Organizer:')
    expect(doc.content).not.toContain('@')

    expect(doc.content).toContain('Attendees: 2')
    expect(doc.content).toContain('Event: Quarterly sync')

    const tags = googleCalendarConnector.mapTags?.(doc.metadata ?? {}) ?? {}
    expect(tags.organizer).toBeUndefined()
    expect(tags.attendeeCount).toBe(2)
    expect(JSON.stringify(tags)).not.toContain('@')
  })

  it('changes the content hash when the toggle flips so existing documents re-hydrate', async () => {
    const on = await listOne({})
    const off = await listOne({ includeAttendees: 'false' })
    expect(off.contentHash).not.toBe(on.contentHash)
  })
})
