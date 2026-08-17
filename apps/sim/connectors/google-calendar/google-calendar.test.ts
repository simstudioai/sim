/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { googleCalendarConnector } from '@/connectors/google-calendar/google-calendar'
import { googleCalendarConnectorMeta } from '@/connectors/google-calendar/meta'

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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
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
  vi.unstubAllGlobals()
})

async function listOne(sourceConfig: Record<string, unknown>) {
  const result = await googleCalendarConnector.listDocuments('token', sourceConfig)
  expect(result.documents).toHaveLength(1)
  return result.documents[0]
}

describe('google-calendar attendee PII opt-out', () => {
  it('exposes an includeAttendees config field defaulting to on', () => {
    const field = googleCalendarConnectorMeta.configFields.find((f) => f.id === 'includeAttendees')
    expect(field).toBeDefined()
    expect(field?.options?.map((o) => o.id)).toEqual(['true', 'false'])
    expect(field?.description).toBeTruthy()
  })

  it('keeps the organizer tag definition even though the tag can now be absent', () => {
    expect(googleCalendarConnectorMeta.tagDefinitions?.map((t) => t.id)).toContain('organizer')
    expect(googleCalendarConnectorMeta.tagDefinitions?.map((t) => t.id)).toContain('attendeeCount')
  })

  it('indexes attendee and organizer identifiers when unset (default on)', async () => {
    const doc = await listOne({})
    expect(doc.content).toContain(`Organizer: Grace Hopper (${ORGANIZER_EMAIL})`)
    expect(doc.content).toContain(`Attendees: ${ATTENDEE_NAME}, second@example.com`)
    expect(doc.contentHash).toBe('gcal:evt-1:2026-01-02T00:00:00Z')

    const tags = googleCalendarConnector.mapTags?.(doc.metadata ?? {}) ?? {}
    expect(tags.organizer).toBe(`Grace Hopper (${ORGANIZER_EMAIL})`)
    expect(tags.attendeeCount).toBe(2)
  })

  it('produces identical output when explicitly enabled', async () => {
    const unset = await listOne({})
    const enabled = await listOne({ includeAttendees: 'true' })
    expect(enabled.content).toBe(unset.content)
    expect(enabled.contentHash).toBe(unset.contentHash)
  })

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

  it('keeps listDocuments and getDocument hashes byte-identical in both states', async () => {
    for (const sourceConfig of [{}, { includeAttendees: 'false' }]) {
      const listed = await listOne(sourceConfig)
      const fetched = await googleCalendarConnector.getDocument('token', sourceConfig, 'evt-1')
      expect(fetched).not.toBeNull()
      expect(fetched?.contentHash).toBe(listed.contentHash)
      expect(fetched?.content).toBe(listed.content)
    }
  })

  it('keeps the multi-calendar hash namespaced and discriminated', async () => {
    const config = { calendarId: ['a@group.calendar.google.com', 'b@group.calendar.google.com'] }
    const on = await listOne(config)
    const off = await listOne({ ...config, includeAttendees: 'false' })
    expect(on.contentHash).toBe('gcal:a@group.calendar.google.com:evt-1:2026-01-02T00:00:00Z')
    expect(off.contentHash).toBe(`${on.contentHash}:noattendees`)

    const fetched = await googleCalendarConnector.getDocument(
      'token',
      { ...config, includeAttendees: 'false' },
      'a@group.calendar.google.com:evt-1'
    )
    expect(fetched?.contentHash).toBe(off.contentHash)
  })
})
