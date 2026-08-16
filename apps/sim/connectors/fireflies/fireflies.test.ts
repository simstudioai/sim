/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWithRetry } = vi.hoisted(() => ({ mockFetchWithRetry: vi.fn() }))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: mockFetchWithRetry,
  VALIDATE_RETRY_OPTIONS: {},
}))
vi.mock('@/components/icons', () => ({ FirefliesIcon: () => null }))

import { firefliesConnector } from '@/connectors/fireflies/fireflies'

interface GraphQLCall {
  query: string
  variables: Record<string, unknown>
}

/** Replays the given GraphQL bodies in order and records what was sent. */
function mockGraphQL(responses: { status?: number; body: unknown }[]) {
  const calls: GraphQLCall[] = []
  let index = 0
  mockFetchWithRetry.mockImplementation(async (_url: string, options: RequestInit) => {
    calls.push(JSON.parse(String(options.body)))
    const route = responses[Math.min(index++, responses.length - 1)]
    const status = route.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route.body,
      text: async () => JSON.stringify(route.body),
    } as unknown as Response
  })
  return calls
}

function transcript(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Meeting ${id}`,
    date: 1720476826660,
    duration: 45,
    organizer_email: 'organizer@example.com',
    participants: ['a@example.com'],
    transcript_url: `https://app.fireflies.ai/view/${id}`,
    speakers: [{ name: 'Ada' }],
    ...extra,
  }
}

function page(count: number, offset = 0) {
  return {
    body: {
      data: {
        transcripts: Array.from({ length: count }, (_, i) => transcript(`t${offset + i}`)),
      },
    },
  }
}

describe('fireflies listDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes limit/skip/toDate as GraphQL variables and pins the ceiling across pages', async () => {
    const calls = mockGraphQL([page(50), page(1, 50)])
    const syncContext: Record<string, unknown> = {}

    const first = await firefliesConnector.listDocuments('key', {}, undefined, syncContext)
    expect(first.hasMore).toBe(true)
    expect(first.nextCursor).toBe('50')

    await firefliesConnector.listDocuments('key', {}, first.nextCursor, syncContext)

    expect(calls[0].variables.limit).toBe(50)
    expect(calls[0].variables.skip).toBe(0)
    expect(calls[1].variables.skip).toBe(50)
    expect(calls[0].variables.toDate).toBe(calls[1].variables.toDate)
    expect(typeof calls[0].variables.toDate).toBe('string')
    expect(calls[0].query).not.toContain('50')
  })

  it('leaves listingCapped unset when the source is genuinely exhausted', async () => {
    mockGraphQL([page(3)])
    const syncContext: Record<string, unknown> = {}

    const result = await firefliesConnector.listDocuments('key', {}, undefined, syncContext)

    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('leaves listingCapped unset when maxTranscripts lands exactly on exhaustion', async () => {
    mockGraphQL([page(3)])
    const syncContext: Record<string, unknown> = {}

    const result = await firefliesConnector.listDocuments(
      'key',
      { maxTranscripts: '3' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(3)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('flags listingCapped when maxTranscripts hides still-existing transcripts', async () => {
    mockGraphQL([page(4)])
    const syncContext: Record<string, unknown> = {}

    const result = await firefliesConnector.listDocuments(
      'key',
      { maxTranscripts: '3' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(3)
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBe(true)
  })

  it('throws on a GraphQL errors[] payload rather than reporting an empty listing', async () => {
    mockGraphQL([
      { body: { data: {}, errors: [{ message: 'Rate limited', code: 'too_many_requests' }] } },
    ])

    await expect(firefliesConnector.listDocuments('key', {}, undefined, {})).rejects.toThrow(
      /too_many_requests/
    )
  })

  it('throws rather than reporting an empty listing when a 200 body is unreadable', async () => {
    mockFetchWithRetry.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON at position 0')
      },
      text: async () => '<html>gateway</html>',
    } as unknown as Response)
    const syncContext: Record<string, unknown> = {}

    await expect(
      firefliesConnector.listDocuments('key', {}, undefined, syncContext)
    ).rejects.toThrow(/malformed/i)
  })

  it('throws rather than reporting an empty listing when a 200 carries no data', async () => {
    mockGraphQL([{ body: {} }])

    await expect(firefliesConnector.listDocuments('key', {}, undefined, {})).rejects.toThrow(
      /malformed/i
    )
  })

  it('surfaces the errors[] message on a non-2xx response', async () => {
    mockGraphQL([
      { status: 403, body: { errors: [{ message: 'Upgrade required', code: 'paid_required' }] } },
    ])

    await expect(firefliesConnector.listDocuments('key', {}, undefined, {})).rejects.toThrow(
      /Upgrade required/
    )
  })
})

describe('fireflies getDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('declares the transcript id as String! and reuses the stub contentHash', async () => {
    const calls = mockGraphQL([
      page(1),
      {
        body: {
          data: {
            transcript: transcript('t0', {
              sentences: [{ speaker_name: 'Ada', text: 'Hello' }],
              summary: { overview: 'An overview', keywords: ['alpha'] },
            }),
          },
        },
      },
    ])

    const listed = await firefliesConnector.listDocuments('key', {}, undefined, {})
    const stub = listed.documents[0]
    const full = await firefliesConnector.getDocument('key', {}, 't0')

    expect(calls[1].query).toContain('$id: String!')
    expect(calls[1].variables).toEqual({ id: 't0' })
    expect(full?.contentHash).toBe(stub.contentHash)
    expect(stub.contentDeferred).toBe(true)
    expect(full?.contentDeferred).toBe(false)
    expect(full?.content).toContain('Ada: Hello')
    expect(full?.content).toContain('An overview')
  })

  it('renders duration as minutes, not seconds', async () => {
    mockGraphQL([{ body: { data: { transcript: transcript('t0', { duration: 45 }) } } }])

    const full = await firefliesConnector.getDocument('key', {}, 't0')

    expect(full?.content).toContain('Duration: 45 minutes')
    expect(full?.metadata?.duration).toBe(45)
  })

  it('falls back to organizer_email when the deprecated host_email is absent', async () => {
    mockGraphQL([{ body: { data: { transcript: transcript('t0') } } }])

    const full = await firefliesConnector.getDocument('key', {}, 't0')

    expect(full?.metadata?.hostEmail).toBe('organizer@example.com')
    expect(firefliesConnector.mapTags?.(full?.metadata ?? {}).hostEmail).toBe(
      'organizer@example.com'
    )
  })

  it('returns null when the transcript is not found', async () => {
    mockGraphQL([
      { status: 404, body: { errors: [{ message: 'Not found', code: 'object_not_found' }] } },
    ])

    await expect(firefliesConnector.getDocument('key', {}, 'missing')).resolves.toBeNull()
  })
})

describe('fireflies tags', () => {
  it('produces every declared tagDefinition id', () => {
    const tags = firefliesConnector.mapTags?.({
      hostEmail: 'host@example.com',
      speakers: ['Ada', 'Grace'],
      duration: 45,
      meetingDate: '2024-07-08T22:13:46.660Z',
    })

    expect(Object.keys(tags ?? {}).sort()).toEqual(
      firefliesConnector.tagDefinitions?.map((t) => t.id).sort()
    )
  })
})
