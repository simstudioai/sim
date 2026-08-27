/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { googleMeetConnector } from '@/connectors/google-meet/google-meet'
import { googleMeetConnectorMeta } from '@/connectors/google-meet/meta'

const RECORD_NAME = 'conferenceRecords/abc123'
const SIGNED_IN_NAME = 'Ada Lovelace'
const ANONYMOUS_NAME = 'guest-from-acme'
const PHONE_NAME = '+1 (555) •••-1234'

const RECORD = {
  name: RECORD_NAME,
  startTime: '2026-02-01T10:00:00Z',
  endTime: '2026-02-01T10:30:00Z',
}

const PARTICIPANTS = [
  { name: `${RECORD_NAME}/participants/p1`, signedinUser: { displayName: SIGNED_IN_NAME } },
  { name: `${RECORD_NAME}/participants/p2`, anonymousUser: { displayName: ANONYMOUS_NAME } },
  { name: `${RECORD_NAME}/participants/p3`, phoneUser: { displayName: PHONE_NAME } },
]

const ENTRIES = [
  {
    name: 'e1',
    participant: `${RECORD_NAME}/participants/p1`,
    text: 'Welcome everyone',
    startTime: '2026-02-01T10:01:00Z',
  },
  {
    name: 'e2',
    participant: `${RECORD_NAME}/participants/p3`,
    text: 'Dialing in from the road',
    startTime: '2026-02-01T10:02:00Z',
  },
  {
    name: 'e3',
    participant: `${RECORD_NAME}/participants/p1`,
    text: 'Lets begin',
    startTime: '2026-02-01T10:03:00Z',
  },
]

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
    if (url.includes('/entries')) return jsonResponse({ transcriptEntries: ENTRIES })
    if (url.includes('/participants')) return jsonResponse({ participants: PARTICIPANTS })
    if (url.includes('/transcripts')) {
      return jsonResponse({
        transcripts: [
          {
            name: `${RECORD_NAME}/transcripts/t1`,
            state: 'FILE_GENERATED',
            docsDestination: { document: 'doc-1' },
          },
        ],
      })
    }
    if (url.includes('/conferenceRecords?')) {
      return jsonResponse({ conferenceRecords: [RECORD] })
    }
    if (url.includes('/conferenceRecords/')) return jsonResponse(RECORD)
    throw new Error(`Unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

async function listStub(sourceConfig: Record<string, unknown>) {
  const result = await googleMeetConnector.listDocuments('token', sourceConfig)
  expect(result.documents).toHaveLength(1)
  return result.documents[0]
}

describe('google-meet participant PII opt-out', () => {
  it('exposes an includeParticipants config field defaulting to on', () => {
    const field = googleMeetConnectorMeta.configFields.find((f) => f.id === 'includeParticipants')
    expect(field).toBeDefined()
    expect(field?.options?.map((o) => o.id)).toEqual(['true', 'false'])
    expect(field?.description).toBeTruthy()
  })

  it('keeps the participants tag definition even though the tag can now be absent', () => {
    expect(googleMeetConnectorMeta.tagDefinitions?.map((t) => t.id)).toContain('participants')
  })

  it('indexes participant display names when unset (default on)', async () => {
    const doc = await googleMeetConnector.getDocument('token', {}, RECORD_NAME)
    expect(doc).not.toBeNull()
    expect(doc?.content).toContain(
      `Participants: ${SIGNED_IN_NAME}, ${ANONYMOUS_NAME}, ${PHONE_NAME}`
    )
    expect(doc?.content).toContain(`${SIGNED_IN_NAME}: Welcome everyone`)
    expect(doc?.content).toContain(`${PHONE_NAME}: Dialing in from the road`)
    expect(doc?.contentHash).toBe('gmeet:conferenceRecords/abc123:2026-02-01T10:30:00Z')

    const tags = googleMeetConnector.mapTags?.(doc?.metadata ?? {}) ?? {}
    expect(String(tags.participants)).toContain(SIGNED_IN_NAME)
    expect(String(tags.participants)).toContain(PHONE_NAME)
  })

  it('produces identical output when explicitly enabled', async () => {
    const unset = await googleMeetConnector.getDocument('token', {}, RECORD_NAME)
    const enabled = await googleMeetConnector.getDocument(
      'token',
      { includeParticipants: 'true' },
      RECORD_NAME
    )
    expect(enabled?.content).toBe(unset?.content)
    expect(enabled?.contentHash).toBe(unset?.contentHash)
  })

  it('omits names and phone fragments from content and tags when off', async () => {
    const doc = await googleMeetConnector.getDocument(
      'token',
      { includeParticipants: 'false' },
      RECORD_NAME
    )
    expect(doc).not.toBeNull()

    const serialized = JSON.stringify(doc)
    for (const identifier of [SIGNED_IN_NAME, ANONYMOUS_NAME, PHONE_NAME, '1234', '555']) {
      expect(serialized).not.toContain(identifier)
    }

    expect(doc?.content).toContain('Participants: 3')
    expect(doc?.content).toContain('Speaker 1: Welcome everyone')
    expect(doc?.content).toContain('Speaker 2: Dialing in from the road')
    expect(doc?.content).toContain('Speaker 1: Lets begin')

    const tags = googleMeetConnector.mapTags?.(doc?.metadata ?? {}) ?? {}
    expect(tags.participants).toBeUndefined()
    expect(tags.duration).toBe(30)
  })

  it('changes the content hash when the toggle flips so existing documents re-hydrate', async () => {
    const on = await listStub({})
    const off = await listStub({ includeParticipants: 'false' })
    expect(off.contentHash).toBe(`${on.contentHash}:noparticipants`)
  })

  it('keeps the listing stub and getDocument hashes byte-identical in both states', async () => {
    for (const sourceConfig of [{}, { includeParticipants: 'false' }]) {
      const stub = await listStub(sourceConfig)
      const fetched = await googleMeetConnector.getDocument('token', sourceConfig, RECORD_NAME)
      expect(fetched).not.toBeNull()
      expect(fetched?.contentHash).toBe(stub.contentHash)
    }
  })
})
