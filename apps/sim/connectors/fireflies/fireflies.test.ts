/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/icons', () => ({ FirefliesIcon: () => null }))

import { firefliesConnector } from '@/connectors/fireflies/fireflies'

beforeEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

interface GraphQLCall {
  query: string
  variables: Record<string, unknown>
}

/** Replays the given GraphQL bodies in order and records what was sent. */
function mockGraphQL(
  responses: { status?: number; body: unknown; headers?: Record<string, string> }[]
) {
  const calls: GraphQLCall[] = []
  let index = 0
  const fetchMock = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
    calls.push(JSON.parse(String(options?.body)))
    const route = responses[Math.min(index++, responses.length - 1)]
    const status = route.status ?? 200
    return new Response(JSON.stringify(route.body), { status, headers: route.headers })
  })
  vi.stubGlobal('fetch', fetchMock)
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

  it.each([
    [
      { is_live: true, meeting_info: { summary_status: 'processing' } },
      { is_live: false, meeting_info: { summary_status: 'processing' } },
    ],
    [
      { is_live: false, meeting_info: { summary_status: 'processing' } },
      { is_live: false, meeting_info: { summary_status: 'processed' } },
    ],
  ])('changes the listing hash when transcript lifecycle state changes', async (before, after) => {
    const calls = mockGraphQL([
      { body: { data: { transcripts: [transcript('t0', before)] } } },
      { body: { data: { transcripts: [transcript('t0', after)] } } },
    ])

    const first = await firefliesConnector.listDocuments('key', {}, undefined, {})
    const second = await firefliesConnector.listDocuments('key', {}, undefined, {})

    expect(first.documents[0].contentHash).not.toBe(second.documents[0].contentHash)
    expect(calls[0].query).toContain('is_live')
    expect(calls[0].query).toContain('summary_status')
  })

  it.each(['-1', '1.5', 'Infinity', '9007199254740992', 'opaque'])(
    'rejects invalid pagination cursor %s before calling Fireflies',
    async (cursor) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      await expect(firefliesConnector.listDocuments('key', {}, cursor, {})).rejects.toThrow(
        'Invalid Fireflies connector pagination cursor'
      )
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('marks offset pagination unsafe for deletion reconciliation even when exhausted', async () => {
    mockGraphQL([page(3)])
    const syncContext: Record<string, unknown> = {}

    const result = await firefliesConnector.listDocuments('key', {}, undefined, syncContext)

    expect(result.hasMore).toBe(false)
    expect(result.reconciliationSafe).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('keeps deletion reconciliation disabled when maxTranscripts lands on exhaustion', async () => {
    mockGraphQL([page(3)])
    const syncContext: Record<string, unknown> = {}

    const result = await firefliesConnector.listDocuments(
      'key',
      { maxTranscripts: '3' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(3)
    expect(result.reconciliationSafe).toBe(false)
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

  it.each(['1.5', 'Infinity'])(
    'rejects invalid maxTranscripts %s before calling Fireflies',
    async (maxTranscripts) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      await expect(
        firefliesConnector.listDocuments('key', { maxTranscripts }, undefined, {})
      ).rejects.toThrow(/positive safe integer/)
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('throws on a GraphQL errors[] payload rather than reporting an empty listing', async () => {
    mockGraphQL([
      { body: { data: {}, errors: [{ message: 'Invalid input', code: 'invalid_arguments' }] } },
    ])

    await expect(firefliesConnector.listDocuments('key', {}, undefined, {})).rejects.toThrow(
      /invalid_arguments/
    )
  })

  it('throws rather than reporting an empty listing when a 200 body is unreadable', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>gateway</html>'))
    )
    const syncContext: Record<string, unknown> = {}

    const pending = expect(
      firefliesConnector.listDocuments('key', {}, undefined, syncContext)
    ).rejects.toThrow(/malformed/i)
    await vi.runAllTimersAsync()
    await pending
  })

  it('throws rather than reporting an empty listing when a 200 carries no data', async () => {
    vi.useFakeTimers()
    mockGraphQL([{ body: {} }])

    const pending = expect(
      firefliesConnector.listDocuments('key', {}, undefined, {})
    ).rejects.toThrow(/malformed/i)
    await vi.runAllTimersAsync()
    await pending
  })

  it('throws rather than reporting an empty listing when transcripts are missing', async () => {
    mockGraphQL([{ body: { data: {} } }])

    await expect(firefliesConnector.listDocuments('key', {}, undefined, {})).rejects.toThrow(
      'Fireflies API returned malformed transcript-list data'
    )
  })

  it('rejects malformed transcript rows instead of silently filtering them', async () => {
    mockGraphQL([{ body: { data: { transcripts: [{}] } } }])

    await expect(firefliesConnector.listDocuments('key', {}, undefined, {})).rejects.toThrow(
      'Fireflies API returned malformed transcript metadata'
    )
  })

  it('accepts documented nullable transcript metadata without aborting the listing', async () => {
    mockGraphQL([
      {
        body: {
          data: {
            transcripts: [
              transcript('nullable', {
                title: null,
                date: null,
                duration: null,
                host_email: null,
                organizer_email: null,
                participants: [null],
                transcript_url: null,
                speakers: [null, { name: null }],
                is_live: null,
                meeting_info: null,
              }),
            ],
          },
        },
      },
    ])

    const result = await firefliesConnector.listDocuments('key', {}, undefined, {})

    expect(result.documents).toEqual([
      expect.objectContaining({
        externalId: 'nullable',
        title: 'Untitled Meeting',
        sourceUrl: undefined,
        metadata: {
          hostEmail: undefined,
          duration: null,
          meetingDate: undefined,
          participants: [],
          speakers: [],
        },
      }),
    ])
  })

  it('accepts a transcript when optional metadata fields are omitted', async () => {
    mockGraphQL([{ body: { data: { transcripts: [{ id: 'minimal' }] } } }])

    const result = await firefliesConnector.listDocuments('key', {}, undefined, {})

    expect(result.documents[0]).toMatchObject({
      externalId: 'minimal',
      title: 'Untitled Meeting',
      metadata: {
        participants: [],
        speakers: [],
      },
    })
  })

  it.each([
    ['title', { title: 42 }],
    ['date', { date: '2024-07-08' }],
    ['duration', { duration: '45' }],
    ['participants', { participants: {} }],
    ['speakers', { speakers: [42] }],
    ['meeting_info', { meeting_info: 'processed' }],
  ])('rejects a malformed non-null %s value', async (_field, extra) => {
    mockGraphQL([{ body: { data: { transcripts: [transcript('t0', extra)] } } }])

    await expect(firefliesConnector.listDocuments('key', {}, undefined, {})).rejects.toThrow(
      'Fireflies API returned malformed transcript metadata'
    )
  })

  it('retries one malformed page without discarding the sync', async () => {
    vi.useFakeTimers()
    mockGraphQL([{ body: {} }, page(2)])

    const pending = firefliesConnector.listDocuments('key', {}, undefined, {})
    await vi.runAllTimersAsync()
    const result = await pending

    expect(result.documents).toHaveLength(2)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['HTTP', { status: 500, body: { message: 'Temporary upstream failure' } }],
    [
      'GraphQL',
      {
        body: {
          errors: [{ message: 'Temporary resolver failure', extensions: { status: 500 } }],
        },
      },
    ],
  ])('retries a transient %s 5xx response', async (_kind, failure) => {
    vi.useFakeTimers()
    mockGraphQL([failure, page(2)])

    const pending = firefliesConnector.listDocuments('key', {}, undefined, {})
    await vi.runAllTimersAsync()
    const result = await pending

    expect(result.documents).toHaveLength(2)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it.each([
    [520, 60],
    [522, 120],
  ])('respects Retry-After and retries Cloudflare %i', async (status, retryAfterSeconds) => {
    vi.useFakeTimers()
    mockGraphQL([
      {
        status,
        body: { diagnostic: 'temporary edge failure' },
        headers: { 'retry-after': String(retryAfterSeconds) },
      },
      page(2),
    ])

    const pending = firefliesConnector.listDocuments('key', {}, undefined, {})
    await vi.advanceTimersByTimeAsync(retryAfterSeconds * 1000 - 1)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    const result = await pending

    expect(result.documents).toHaveLength(2)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('respects Retry-After when a retryable error body exceeds the diagnostic limit', async () => {
    vi.useFakeTimers()
    const retryAfterSeconds = 60
    mockGraphQL([
      {
        status: 503,
        body: { diagnostic: 'body is not materialized' },
        headers: {
          'content-length': String(16 * 1024 * 1024 + 1),
          'retry-after': String(retryAfterSeconds),
        },
      },
      page(2),
    ])

    const pending = firefliesConnector.listDocuments('key', {}, undefined, {})
    await vi.advanceTimersByTimeAsync(retryAfterSeconds * 1000 - 1)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    const result = await pending

    expect(result.documents).toHaveLength(2)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('parses an HTTP 429 GraphQL retry timestamp before retrying', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
    mockGraphQL([
      {
        status: 429,
        body: {
          errors: [
            {
              message: 'Rate limited',
              code: 'too_many_requests',
              extensions: { status: 429, metadata: { retryAfter: Date.now() + 60_000 } },
            },
          ],
        },
      },
      page(1),
    ])

    const pending = firefliesConnector.listDocuments('key', {}, undefined, {})
    await vi.advanceTimersByTimeAsync(60_000)
    await expect(pending).resolves.toMatchObject({ documents: [{ externalId: 't0' }] })
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('surfaces a validated errors[] code without the provider message', async () => {
    mockGraphQL([
      { status: 403, body: { errors: [{ message: 'Upgrade required', code: 'paid_required' }] } },
    ])

    await expect(firefliesConnector.listDocuments('key', {}, undefined, {})).rejects.toThrow(
      /paid_required/
    )
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('bounds non-retryable GraphQL error responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('x'.repeat(17 * 1024 * 1024), { status: 403, statusText: 'Forbidden' })
      )
    )

    await expect(firefliesConnector.listDocuments('key', {}, undefined, {})).rejects.toThrow(
      /exceeded the diagnostic limit/i
    )
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('fireflies validateConfig', () => {
  it.each(['1.5', 'Infinity'])(
    'rejects invalid maxTranscripts %s without an API request',
    async (maxTranscripts) => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)

      await expect(firefliesConnector.validateConfig!('key', { maxTranscripts })).resolves.toEqual({
        valid: false,
        error: 'Max transcripts must be a positive safe integer, or 0 for unlimited',
      })
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  it('accepts a valid integer maxTranscripts', async () => {
    mockGraphQL([{ body: { data: { user: { user_id: 'user-1' } } } }])

    await expect(
      firefliesConnector.validateConfig!('key', { maxTranscripts: '25' })
    ).resolves.toEqual({ valid: true })
  })
})

describe('fireflies getDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each([null, {}, transcript('different')])(
    'rejects malformed or mismatched successful transcript metadata',
    async (value) => {
      mockGraphQL([{ body: { data: { transcript: value } } }])

      await expect(firefliesConnector.getDocument('key', {}, 't0')).rejects.toThrow(
        'Fireflies API returned malformed transcript metadata'
      )
    }
  )

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

  it('normalizes documented nullable nested transcript fields during hydration', async () => {
    mockGraphQL([
      {
        body: {
          data: {
            transcript: transcript('nullable', {
              title: null,
              date: null,
              duration: null,
              host_email: null,
              organizer_email: null,
              participants: [null, 'participant@example.test'],
              transcript_url: null,
              speakers: [null, { name: null }, { name: 'Ada' }],
              is_live: null,
              meeting_info: { summary_status: null },
              sentences: [
                null,
                { speaker_name: null, text: 'Hello' },
                { speaker_name: 'Ada', text: null },
              ],
              summary: {
                keywords: null,
                action_items: null,
                overview: null,
                short_summary: null,
              },
            }),
          },
        },
      },
    ])

    const result = await firefliesConnector.getDocument('key', {}, 'nullable')

    expect(result).toMatchObject({
      externalId: 'nullable',
      title: 'Untitled Meeting',
      sourceUrl: undefined,
      contentDeferred: false,
      metadata: {
        hostEmail: undefined,
        duration: null,
        meetingDate: undefined,
        participants: ['participant@example.test'],
        speakers: ['Ada'],
        keywords: null,
      },
    })
    expect(result?.content).toContain('Unknown speaker: Hello')
    expect(result?.content).not.toContain('Ada: null')
  })

  it.each([
    ['sentences', { sentences: [42] }],
    ['summary', { summary: { overview: 42 } }],
    ['summary keywords', { summary: { keywords: [42] } }],
  ])('rejects malformed non-null hydrated %s metadata', async (_field, extra) => {
    mockGraphQL([{ body: { data: { transcript: transcript('t0', extra) } } }])

    await expect(firefliesConnector.getDocument('key', {}, 't0')).rejects.toThrow(
      'Fireflies API returned malformed transcript metadata'
    )
  })

  it('renders duration as minutes, not seconds', async () => {
    mockGraphQL([{ body: { data: { transcript: transcript('t0', { duration: 45 }) } } }])

    const full = await firefliesConnector.getDocument('key', {}, 't0')

    expect(full?.content).toContain('Duration: 45 minutes')
    expect(full?.metadata?.duration).toBe(45)
  })

  it('formats the documented string keyword shape and tolerates legacy arrays', async () => {
    mockGraphQL([
      {
        body: {
          data: { transcript: transcript('t0', { summary: { keywords: 'alpha, beta' } }) },
        },
      },
      {
        body: {
          data: { transcript: transcript('t1', { summary: { keywords: ['alpha', 'beta'] } }) },
        },
      },
    ])

    const documented = await firefliesConnector.getDocument('key', {}, 't0')
    const legacy = await firefliesConnector.getDocument('key', {}, 't1')

    expect(documented?.content).toContain('Keywords: alpha, beta')
    expect(legacy?.content).toContain('Keywords: alpha, beta')
  })

  it('surfaces extracted transcript content beyond its byte budget as skipped', async () => {
    mockGraphQL([
      {
        body: {
          data: {
            transcript: transcript('t0', {
              sentences: [{ speaker_name: 'Ada', text: 'x'.repeat(9 * 1024 * 1024) }],
            }),
          },
        },
      },
    ])

    const result = await firefliesConnector.getDocument('key', {}, 't0')

    expect(result).toMatchObject({ content: '', contentDeferred: false })
    expect(result?.skippedReason).toContain('8MB')
  })

  it('admits a hydration envelope exactly at the wire limit before applying the content cap', async () => {
    const maxResponseBytes = 16 * 1024 * 1024
    const responseBody = (text: string) => ({
      data: {
        transcript: transcript('boundary', {
          sentences: [{ speaker_name: 'Ada', text }],
        }),
      },
    })
    const emptyEnvelopeBytes = Buffer.byteLength(JSON.stringify(responseBody('')), 'utf8')
    const serialized = JSON.stringify(
      responseBody('x'.repeat(maxResponseBytes - emptyEnvelopeBytes))
    )
    expect(Buffer.byteLength(serialized, 'utf8')).toBe(maxResponseBytes)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(serialized))
    )

    const result = await firefliesConnector.getDocument('key', {}, 'boundary')

    expect(result).toMatchObject({ content: '', contentDeferred: false })
    expect(result?.skippedReason).toContain('8MB extracted-content limit')
  })

  it('surfaces JSON escape expansion beyond the wire cap as a visible skip', async () => {
    const escapedText = '\u0000'.repeat(3 * 1024 * 1024)
    const responseBody = JSON.stringify({
      data: {
        transcript: transcript('escaped', {
          sentences: [{ speaker_name: 'Ada', text: escapedText }],
        }),
      },
    })
    expect(Buffer.byteLength(escapedText, 'utf8')).toBeLessThan(8 * 1024 * 1024)
    expect(Buffer.byteLength(responseBody, 'utf8')).toBeGreaterThan(16 * 1024 * 1024)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(responseBody))
    )

    const result = await firefliesConnector.getDocument('key', {}, 'escaped')

    expect(result).toMatchObject({
      externalId: 'escaped',
      content: '',
      contentDeferred: false,
      skippedReason:
        'Transcript response exceeds the 16MB safe hydration limit and was not indexed',
    })
  })

  it('does not convert an oversized provider error response into a skipped transcript', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('x'.repeat(17 * 1024 * 1024), { status: 403 }))
    )

    await expect(firefliesConnector.getDocument('key', {}, 'provider-error')).rejects.toThrow(
      /HTTP error: 403/
    )
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
