/**
 * @vitest-environment node
 *
 * `GET /articleVersions` returns one row per article *revision* and offers no
 * latest-version filter, so what this connector indexes is decided entirely by
 * the required status choice and the version cap. Both are exercised here, along
 * with the `listingCapped` flag the sync engine reads before hard-deleting the
 * documents a partial listing left out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { workdayConnector } from '@/connectors/workday/workday'

const ACCESS_TOKEN = 'client-secret:refresh-token'
const CONFIG = {
  tenantUrl: 'https://wd5-impl-services1.workday.com',
  tenant: 'acme_pt1',
  clientId: 'client-id',
  status: 'Published',
}

const PUBLISHED_ID = '0d75a5e37a411000167d21b9239f0001'
const AUDIENCE_ID = '8ac3f16c1fff10000c53e90920940001'

const mockFetch = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function versionFixture(id: string, version = 1) {
  return {
    id,
    title: `Article ${id}`,
    content: 'Body text',
    version,
    lastUpdatedDate: '2026-01-01T00:00:00.000Z',
    parentArticle: { id: `parent-${id}`, descriptor: `Article ${id}` },
    status: { id: PUBLISHED_ID, descriptor: 'Published' },
  }
}

/**
 * Routes by URL rather than call order, because the number of lookups before the
 * listing depends on which filters the config asks for.
 */
function mockApi(listing: unknown, options: { audiences?: unknown } = {}) {
  mockFetch.mockImplementation(async (url: string) => {
    if (url.includes('/ccx/oauth2/')) {
      return jsonResponse({ access_token: 'bearer', expires_in: 3600 })
    }
    if (url.includes('/articleStatuses')) {
      return jsonResponse({
        total: 3,
        data: [
          { id: PUBLISHED_ID, descriptor: 'Published' },
          { id: 'aaaa5a5e37a411000167d21b9239f002', descriptor: 'Draft' },
          { id: 'bbbb5a5e37a411000167d21b9239f003', descriptor: 'Archived' },
        ],
      })
    }
    if (url.includes('/values/common/audiences')) {
      return jsonResponse(
        options.audiences ?? {
          total: 1,
          data: [{ id: AUDIENCE_ID, descriptor: 'All Employees' }],
        }
      )
    }
    return jsonResponse(listing)
  })
}

function tokenExchanges(): string[] {
  return mockFetch.mock.calls
    .map(([url]) => url as string)
    .filter((url) => url.includes('/ccx/oauth2/'))
}

function listingUrls(): string[] {
  return mockFetch.mock.calls
    .map(([url]) => url as string)
    .filter((url) => url.includes('/articleVersions'))
}

describe('workday listDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves the status name to the tenant Workday ID and filters the listing by it', async () => {
    mockApi({ total: 1, data: [versionFixture('a')] })

    const result = await workdayConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, {})

    expect(listingUrls()[0]).toContain(`status=${PUBLISHED_ID}`)
    expect(result.documents).toHaveLength(1)
    expect(result.documents[0].externalId).toBe('a')
  })

  it('omits the status filter only when the operator explicitly chose every status', async () => {
    mockApi({ total: 1, data: [versionFixture('a')] })

    await workdayConnector.listDocuments(ACCESS_TOKEN, { ...CONFIG, status: 'all' }, undefined, {})

    expect(listingUrls()[0]).not.toContain('status=')
    expect(mockFetch.mock.calls.some(([url]) => (url as string).includes('/articleStatuses'))).toBe(
      false
    )
  })

  it('refuses to list when no status was chosen, rather than indexing every revision', async () => {
    mockApi({ total: 1, data: [versionFixture('a')] })

    await expect(
      workdayConnector.listDocuments(ACCESS_TOKEN, { ...CONFIG, status: '' }, undefined, {})
    ).rejects.toThrow(/Article Status is required/)
  })

  it('resolves audience names to Workday IDs', async () => {
    mockApi({ total: 1, data: [versionFixture('a')] })

    await workdayConnector.listDocuments(
      ACCESS_TOKEN,
      { ...CONFIG, audience: 'All Employees' },
      undefined,
      {}
    )

    expect(listingUrls()[0]).toContain(`audience=${AUDIENCE_ID}`)
  })

  it('names the available audiences when one cannot be resolved', async () => {
    mockApi({ total: 1, data: [versionFixture('a')] })

    await expect(
      workdayConnector.listDocuments(
        ACCESS_TOKEN,
        { ...CONFIG, audience: 'Contractors' },
        undefined,
        {}
      )
    ).rejects.toThrow(/no audience named "Contractors". Available: All Employees/)
  })

  it('leaves listingCapped unset when the cap lands exactly on source exhaustion', async () => {
    mockApi({ total: 1, data: [versionFixture('a')] })

    const syncContext: Record<string, unknown> = {}
    await workdayConnector.listDocuments(
      ACCESS_TOKEN,
      { ...CONFIG, maxVersions: '1' },
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('flags listingCapped when the cap stops short of the tenant total', async () => {
    mockApi({ total: 10, data: [versionFixture('a')] })

    const syncContext: Record<string, unknown> = {}
    await workdayConnector.listDocuments(
      ACCESS_TOKEN,
      { ...CONFIG, maxVersions: '1' },
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBe(true)
  })

  it('leaves listingCapped unset when an uncapped page exhausts the source', async () => {
    mockApi({ total: 2, data: [versionFixture('a'), versionFixture('b')] })

    const syncContext: Record<string, unknown> = {}
    const result = await workdayConnector.listDocuments(
      ACCESS_TOKEN,
      CONFIG,
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBeUndefined()
    expect(result.hasMore).toBe(false)
  })

  it('requests only the versions the cap still allows on the final page', async () => {
    mockApi({ total: 500, data: [versionFixture('a')] })

    await workdayConnector.listDocuments(ACCESS_TOKEN, { ...CONFIG, maxVersions: '101' }, '100', {})

    expect(listingUrls()[0]).toContain('limit=1')
    expect(listingUrls()[0]).toContain('offset=100')
  })

  it('strips a path and trailing slash from the configured tenant host', async () => {
    mockApi({ total: 1, data: [versionFixture('a')] })

    await workdayConnector.listDocuments(
      ACCESS_TOKEN,
      { ...CONFIG, tenantUrl: 'https://wd5-impl-services1.workday.com/acme_pt1/d/home.htmld' },
      undefined,
      {}
    )

    expect(listingUrls()[0]).toContain(
      'https://wd5-impl-services1.workday.com/ccx/api/helpArticle/v1/acme_pt1/articleVersions?'
    )
  })

  it('accepts a tenant host written without a scheme', async () => {
    mockApi({ total: 1, data: [versionFixture('a')] })

    await workdayConnector.listDocuments(
      ACCESS_TOKEN,
      { ...CONFIG, tenantUrl: 'wd5-impl-services1.workday.com' },
      undefined,
      {}
    )

    expect(listingUrls()[0]).toContain(
      'https://wd5-impl-services1.workday.com/ccx/api/helpArticle/v1/acme_pt1/articleVersions?'
    )
  })

  it('passes a Workday ID through instead of looking it up as a display name', async () => {
    mockApi({ total: 1, data: [versionFixture('a')] })

    await workdayConnector.listDocuments(
      ACCESS_TOKEN,
      { ...CONFIG, audience: AUDIENCE_ID },
      undefined,
      {}
    )

    expect(listingUrls()[0]).toContain(`audience=${AUDIENCE_ID}`)
    expect(
      mockFetch.mock.calls.some(([url]) => (url as string).includes('/values/common/audiences'))
    ).toBe(false)
  })

  it('caps how many available values an unresolved-name error names', async () => {
    const many = Array.from({ length: 30 }, (_, index) => ({
      id: `${index}`.padStart(32, '0'),
      descriptor: `Audience ${index}`,
    }))
    mockApi({ total: 1, data: [versionFixture('a')] }, { audiences: { total: 30, data: many } })

    const error = await workdayConnector
      .listDocuments(ACCESS_TOKEN, { ...CONFIG, audience: 'Nope' }, undefined, {})
      .catch((thrown: Error) => thrown)

    expect((error as Error).message).toContain('and 10 more')
    expect((error as Error).message).not.toContain('Audience 25')
  })

  it('reads a version cap persisted as a number rather than a string', async () => {
    mockApi({ total: 500, data: [versionFixture('a')] })

    await workdayConnector.listDocuments(ACCESS_TOKEN, { ...CONFIG, maxVersions: 1 }, undefined, {})

    expect(listingUrls()[0]).toContain('limit=1')
  })

  it('rejects a tenant host that is not a Workday domain', async () => {
    mockApi({ total: 0, data: [] })

    await expect(
      workdayConnector.listDocuments(
        ACCESS_TOKEN,
        { ...CONFIG, tenantUrl: 'https://evil.example.com' },
        undefined,
        {}
      )
    ).rejects.toThrow(/Workday-hosted domain/)
  })
})

describe('workday credential failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('explains that a rejected refresh token has to be re-entered', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'invalid_grant' }, 400))

    const result = await workdayConnector.validateConfig(ACCESS_TOKEN, CONFIG)

    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Manage Refresh Tokens for Integrations/)
  })

  it('buys one bearer token for a whole sync run and reuses it across pages', async () => {
    mockApi({ total: 500, data: [versionFixture('a')] })
    const syncContext: Record<string, unknown> = {}

    await workdayConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, syncContext)
    await workdayConnector.listDocuments(ACCESS_TOKEN, CONFIG, '100', syncContext)

    expect(tokenExchanges()).toHaveLength(1)
  })

  it('re-authenticates once and replays the request when a cached token has expired', async () => {
    let listingCalls = 0
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/ccx/oauth2/')) {
        return jsonResponse({ access_token: 'bearer', expires_in: 3600 })
      }
      if (url.includes('/articleStatuses')) {
        return jsonResponse({ total: 1, data: [{ id: PUBLISHED_ID, descriptor: 'Published' }] })
      }
      listingCalls += 1
      return listingCalls === 1
        ? jsonResponse({ error: 'expired token' }, 401)
        : jsonResponse({ total: 1, data: [versionFixture('a')] })
    })

    const result = await workdayConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, {})

    expect(result.documents).toHaveLength(1)
    expect(listingCalls).toBe(2)
    expect(tokenExchanges()).toHaveLength(2)
  })

  it('surfaces a persistent 401 instead of retrying the exchange forever', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/ccx/oauth2/')) {
        return jsonResponse({ access_token: 'bearer', expires_in: 3600 })
      }
      if (url.includes('/articleStatuses')) {
        return jsonResponse({ total: 1, data: [{ id: PUBLISHED_ID, descriptor: 'Published' }] })
      }
      return jsonResponse({ error: 'still unauthorized' }, 401)
    })

    await expect(
      workdayConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, {})
    ).rejects.toThrow(/still unauthorized/)
    expect(tokenExchanges()).toHaveLength(2)
  })

  it('rejects a version cap that is not a positive number', async () => {
    mockApi({ total: 0, data: [] })

    const result = await workdayConnector.validateConfig(ACCESS_TOKEN, {
      ...CONFIG,
      maxVersions: '0',
    })

    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/positive number/)
  })

  it('refuses a tenant that answered the status filter with another status', async () => {
    mockApi({
      total: 1,
      data: [{ ...versionFixture('a'), status: { id: 'other', descriptor: 'Draft' } }],
    })

    const result = await workdayConnector.validateConfig(ACCESS_TOKEN, CONFIG)

    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/ignored the article status filter/)
  })

  it('rejects a credential that is not a clientSecret:refreshToken pair', async () => {
    mockApi({ total: 0, data: [] })

    const result = await workdayConnector.validateConfig('only-one-secret', CONFIG)

    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/clientSecret:refreshToken/)
  })
})

describe('workday document mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('produces the same contentHash from the listing and from getDocument', async () => {
    mockApi({ total: 1, data: [versionFixture('a', 4)] })
    const listed = await workdayConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, {})

    vi.clearAllMocks()
    mockFetch.mockImplementation(async (url: string) =>
      url.includes('/ccx/oauth2/')
        ? jsonResponse({ access_token: 'bearer', expires_in: 3600 })
        : jsonResponse(versionFixture('a', 4))
    )
    const fetched = await workdayConnector.getDocument(ACCESS_TOKEN, CONFIG, 'a', {})

    expect(fetched?.contentHash).toBe(listed.documents[0].contentHash)
    expect(fetched?.contentHash).toBe('workday:a:4:2026-01-01T00:00:00.000Z')
  })

  it('returns null for an article version the tenant no longer has', async () => {
    mockFetch.mockImplementation(async (url: string) =>
      url.includes('/ccx/oauth2/')
        ? jsonResponse({ access_token: 'bearer', expires_in: 3600 })
        : jsonResponse({ error: 'not found' }, 404)
    )

    expect(await workdayConnector.getDocument(ACCESS_TOKEN, CONFIG, 'gone', {})).toBeNull()
  })

  it('indexes documented plain-text content verbatim', async () => {
    mockApi({
      total: 1,
      data: [{ ...versionFixture('a'), content: 'Email support <help@acme.com> for 5 < 10 cases' }],
    })

    const result = await workdayConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, {})

    expect(result.documents[0].content).toBe('Email support <help@acme.com> for 5 < 10 cases')
  })

  it('reduces a tenant that emits real markup to plain text', async () => {
    mockApi({
      total: 1,
      data: [{ ...versionFixture('a'), content: '<p>Reset your <strong>password</strong>.</p>' }],
    })

    const result = await workdayConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, {})

    expect(result.documents[0].content).toBe('Reset your password .')
  })

  it('maps every declared tag from the metadata the listing stores', async () => {
    mockApi({
      total: 1,
      data: [
        {
          ...versionFixture('a', 2),
          createdDate: '2025-06-01T00:00:00.000Z',
          category: { id: 'c1', descriptor: 'Benefits' },
          language: { id: 'l1', descriptor: 'English' },
          audience: [{ id: AUDIENCE_ID, descriptor: 'All Employees' }],
          tags: [
            { id: 't1', descriptor: 'payroll' },
            { id: 't2', descriptor: 'benefits' },
          ],
        },
      ],
    })

    const result = await workdayConnector.listDocuments(ACCESS_TOKEN, CONFIG, undefined, {})
    const tags = workdayConnector.mapTags?.(result.documents[0].metadata ?? {})

    expect(tags).toEqual({
      article: 'Article a',
      category: 'Benefits',
      status: 'Published',
      language: 'English',
      audience: 'All Employees',
      articleTags: 'payroll, benefits',
      version: 2,
      created: new Date('2025-06-01T00:00:00.000Z'),
      lastUpdated: new Date('2026-01-01T00:00:00.000Z'),
    })
  })
})
