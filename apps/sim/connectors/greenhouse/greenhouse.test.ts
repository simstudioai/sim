/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { greenhouseConnector } from '@/connectors/greenhouse/greenhouse'

const ACCESS_TOKEN = 'test-key'

const mockFetch = vi.fn()

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

/** A `Link` header advertising another page, exactly as Harvest emits it. */
const NEXT_PAGE_LINK = {
  link: '<https://harvest.greenhouse.io/v1/candidates?page=2&per_page=500>; rel="next"',
}

function candidateFixture(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    first_name: 'Ada',
    last_name: `Lovelace ${id}`,
    company: 'Analytical Engines',
    title: 'Engineer',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-02-01T00:00:00.000Z',
    last_activity: '2024-03-01T00:00:00.000Z',
    email_addresses: [{ value: `ada${id}@example.com`, type: 'personal' }],
    tags: ['referral'],
    application_ids: [900 + id],
    applications: [{ id: 900 + id, applied_at: '2024-01-02T00:00:00.000Z' }],
    ...overrides,
  }
}

function requestUrl(callIndex = 0): URL {
  const call = mockFetch.mock.calls[callIndex]
  if (!call) throw new Error(`No fetch call at index ${callIndex}`)
  return new URL(String(call[0]))
}

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('greenhouseConnector auth', () => {
  it('sends Basic auth as base64 of the api key with an empty password', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]))

    await greenhouseConnector.listDocuments(ACCESS_TOKEN, {}, undefined, {})

    const init = mockFetch.mock.calls[0][1] as RequestInit
    const header = (init.headers as Record<string, string>).Authorization
    expect(header).toBe(`Basic ${Buffer.from('test-key:').toString('base64')}`)
    expect(Buffer.from(header.replace('Basic ', ''), 'base64').toString()).toBe('test-key:')
  })
})

describe('greenhouseConnector.listDocuments pagination', () => {
  it('keeps per_page constant across pages so page-number paging cannot slide', async () => {
    const fullPage = Array.from({ length: 500 }, (_, i) => candidateFixture(i + 1))
    mockFetch.mockImplementation(() => Promise.resolve(jsonResponse(fullPage, 200, NEXT_PAGE_LINK)))
    const syncContext: Record<string, unknown> = {}

    const first = await greenhouseConnector.listDocuments(
      ACCESS_TOKEN,
      { maxCandidates: '600' },
      undefined,
      syncContext
    )
    expect(first.hasMore).toBe(true)

    await greenhouseConnector.listDocuments(
      ACCESS_TOKEN,
      { maxCandidates: '600' },
      first.nextCursor,
      syncContext
    )

    expect(requestUrl(0).searchParams.get('per_page')).toBe('500')
    expect(requestUrl(1).searchParams.get('per_page')).toBe('500')
    expect(requestUrl(1).searchParams.get('page')).toBe('2')
  })

  it('forwards the configured scope filters', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]))

    await greenhouseConnector.listDocuments(
      ACCESS_TOKEN,
      {
        jobId: '123456',
        createdAfter: '2024-01-01T00:00:00Z',
        createdBefore: '2024-12-31T23:59:59Z',
      },
      undefined,
      {}
    )

    const params = requestUrl().searchParams
    expect(params.get('job_id')).toBe('123456')
    expect(params.get('created_after')).toBe('2024-01-01T00:00:00Z')
    expect(params.get('created_before')).toBe('2024-12-31T23:59:59Z')
  })
})

describe('greenhouseConnector listingCapped', () => {
  it('leaves listingCapped unset when the source is exhausted', async () => {
    mockFetch.mockResolvedValue(jsonResponse([candidateFixture(1), candidateFixture(2)]))
    const syncContext: Record<string, unknown> = {}

    const result = await greenhouseConnector.listDocuments(
      ACCESS_TOKEN,
      { maxCandidates: '10' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(2)
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('leaves listingCapped unset when the cap lands exactly on exhaustion', async () => {
    mockFetch.mockResolvedValue(jsonResponse([candidateFixture(1), candidateFixture(2)]))
    const syncContext: Record<string, unknown> = {}

    await greenhouseConnector.listDocuments(
      ACCESS_TOKEN,
      { maxCandidates: '2' },
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('flags listingCapped when the cap hides candidates on the same page', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([candidateFixture(1), candidateFixture(2), candidateFixture(3)])
    )
    const syncContext: Record<string, unknown> = {}

    const result = await greenhouseConnector.listDocuments(
      ACCESS_TOKEN,
      { maxCandidates: '2' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(2)
    expect(syncContext.listingCapped).toBe(true)
  })

  it('flags listingCapped when the cap stops paging while a next page exists', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([candidateFixture(1), candidateFixture(2)], 200, NEXT_PAGE_LINK)
    )
    const syncContext: Record<string, unknown> = {}

    const result = await greenhouseConnector.listDocuments(
      ACCESS_TOKEN,
      { maxCandidates: '2' },
      undefined,
      syncContext
    )

    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBe(true)
  })

  it('does not flag listingCapped when no cap is configured', async () => {
    mockFetch.mockResolvedValue(jsonResponse([candidateFixture(1)]))
    const syncContext: Record<string, unknown> = {}

    await greenhouseConnector.listDocuments(ACCESS_TOKEN, {}, undefined, syncContext)

    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('throws instead of reporting an empty listing when the API fails', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'nope' }, 500))

    await expect(
      greenhouseConnector.listDocuments(ACCESS_TOKEN, {}, undefined, {})
    ).rejects.toThrow('500')
  })
})

describe('greenhouseConnector.getDocument', () => {
  /** Mocks the candidate + activity feed + scorecards calls a hydration makes. */
  function mockHydration(scorecardsResponse: Response) {
    mockFetch.mockImplementation((url: string) => {
      const href = String(url)
      if (href.includes('/activity_feed')) {
        return Promise.resolve(
          jsonResponse({ notes: [{ body: '<p>Great chat</p>', created_at: '2024-02-02' }] })
        )
      }
      if (href.includes('/scorecards')) return Promise.resolve(scorecardsResponse)
      return Promise.resolve(jsonResponse(candidateFixture(1)))
    })
  }

  it('produces the same contentHash as the listing stub', async () => {
    mockFetch.mockResolvedValue(jsonResponse([candidateFixture(1)]))
    const listed = await greenhouseConnector.listDocuments(ACCESS_TOKEN, {}, undefined, {})
    const stub = listed.documents[0]
    expect(stub.contentDeferred).toBe(true)
    expect(stub.content).toBe('')

    mockFetch.mockReset()
    mockHydration(jsonResponse([{ id: 1, interview: 'Onsite', overall_recommendation: 'yes' }]))

    const full = await greenhouseConnector.getDocument(ACCESS_TOKEN, {}, stub.externalId)

    expect(full?.contentHash).toBe(stub.contentHash)
    expect(full?.contentDeferred).toBe(false)
    expect(full?.content).toContain('Great chat')
    expect(full?.content).not.toContain('<p>')
  })

  it('folds last_activity into the hash so feed-only changes are detected', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([candidateFixture(1, { last_activity: '2024-09-09T00:00:00.000Z' })])
    )
    const moved = await greenhouseConnector.listDocuments(ACCESS_TOKEN, {}, undefined, {})

    mockFetch.mockResolvedValue(jsonResponse([candidateFixture(1)]))
    const original = await greenhouseConnector.listDocuments(ACCESS_TOKEN, {}, undefined, {})

    expect(moved.documents[0].contentHash).not.toBe(original.documents[0].contentHash)
  })

  it('marks the hash partial when scorecards could not be fetched, so the next sync retries', async () => {
    mockFetch.mockResolvedValue(jsonResponse([candidateFixture(1)]))
    const listed = await greenhouseConnector.listDocuments(ACCESS_TOKEN, {}, undefined, {})
    const stubHash = listed.documents[0].contentHash

    mockFetch.mockReset()
    mockHydration(jsonResponse({ error: 'nope' }, 500))
    const partial = await greenhouseConnector.getDocument(ACCESS_TOKEN, {}, '1')

    mockFetch.mockReset()
    mockHydration(jsonResponse([]))
    const complete = await greenhouseConnector.getDocument(ACCESS_TOKEN, {}, '1')

    expect(partial?.contentHash).not.toBe(stubHash)
    expect(partial?.content).toContain('Great chat')
    expect(complete?.contentHash).toBe(stubHash)
  })

  it('treats a 404 scorecard list as a complete absence, not a partial fetch', async () => {
    mockFetch.mockResolvedValue(jsonResponse([candidateFixture(1)]))
    const listed = await greenhouseConnector.listDocuments(ACCESS_TOKEN, {}, undefined, {})

    mockFetch.mockReset()
    mockHydration(jsonResponse({}, 404))
    const doc = await greenhouseConnector.getDocument(ACCESS_TOKEN, {}, '1')

    expect(doc?.contentHash).toBe(listed.documents[0].contentHash)
  })

  it('treats a 403 scorecard list as settled, so a permission gap cannot re-hydrate forever', async () => {
    mockFetch.mockResolvedValue(jsonResponse([candidateFixture(1)]))
    const listed = await greenhouseConnector.listDocuments(ACCESS_TOKEN, {}, undefined, {})

    mockFetch.mockReset()
    mockHydration(jsonResponse({ error: 'no access' }, 403))
    const doc = await greenhouseConnector.getDocument(ACCESS_TOKEN, {}, '1')

    expect(doc?.contentHash).toBe(listed.documents[0].contentHash)
  })

  it('returns null for a deleted candidate', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 404))

    await expect(greenhouseConnector.getDocument(ACCESS_TOKEN, {}, '1')).resolves.toBeNull()
  })

  it('throws when the API fails so the sync engine records a failed row', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'nope' }, 500))

    await expect(greenhouseConnector.getDocument(ACCESS_TOKEN, {}, '1')).rejects.toThrow('500')
  })
})

describe('greenhouseConnector.validateConfig', () => {
  it('rejects a non-numeric job id without calling the API', async () => {
    const result = await greenhouseConnector.validateConfig(ACCESS_TOKEN, { jobId: 'Engineering' })

    expect(result.valid).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects an unparseable timestamp without calling the API', async () => {
    const result = await greenhouseConnector.validateConfig(ACCESS_TOKEN, {
      createdAfter: 'last tuesday',
    })

    expect(result.valid).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('accepts a valid config and probes with a single record', async () => {
    mockFetch.mockResolvedValue(jsonResponse([]))

    const result = await greenhouseConnector.validateConfig(ACCESS_TOKEN, {
      jobId: '123456',
      createdAfter: '2024-01-01T00:00:00Z',
    })

    expect(result.valid).toBe(true)
    expect(requestUrl().searchParams.get('per_page')).toBe('1')
  })
})

describe('greenhouseConnector.mapTags', () => {
  it('only emits tag ids declared in tagDefinitions', async () => {
    mockFetch.mockResolvedValue(jsonResponse([candidateFixture(1)]))
    const listed = await greenhouseConnector.listDocuments(ACCESS_TOKEN, {}, undefined, {})

    const declared = new Set((greenhouseConnector.tagDefinitions ?? []).map((t) => t.id))
    const mapped = greenhouseConnector.mapTags?.(listed.documents[0].metadata ?? {})

    expect(Object.keys(mapped ?? {}).length).toBeGreaterThan(0)
    for (const key of Object.keys(mapped ?? {})) {
      expect(declared.has(key)).toBe(true)
    }
    expect(mapped?.updatedAt).toBeInstanceOf(Date)
    expect(mapped?.lastActivity).toBeInstanceOf(Date)
  })
})
