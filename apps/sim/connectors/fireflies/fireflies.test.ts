import { beforeEach, describe, expect, it, vi } from 'vitest'
import { firefliesConnector } from '@/connectors/fireflies/fireflies'

beforeEach(() => {
  vi.useRealTimers()
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
      { body: { data: {}, errors: [{ message: 'Invalid input', code: 'invalid_arguments' }] } },
    ])

    await expect(firefliesConnector.listDocuments('key', {}, undefined, {})).rejects.toThrow(
      /invalid_arguments/
    )
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

  it('rejects malformed transcript rows instead of silently filtering them', async () => {
    mockGraphQL([{ body: { data: { transcripts: [{}] } } }])

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
})

describe('fireflies getDocument', () => {
  it.each([null, {}, transcript('different')])(
    'rejects malformed or mismatched successful transcript metadata',
    async (value) => {
      mockGraphQL([{ body: { data: { transcript: value } } }])

      await expect(firefliesConnector.getDocument('key', {}, 't0')).rejects.toThrow(
        'Fireflies API returned malformed transcript metadata'
      )
    }
  )

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
})
