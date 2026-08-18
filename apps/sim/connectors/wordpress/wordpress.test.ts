/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { wordpressConnector } from '@/connectors/wordpress/wordpress'

const ACCESS_TOKEN = 'test-token'
const SITE_CONFIG = { siteUrl: 'mysite.wordpress.com' }

const mockFetch = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Resolves the URL of the nth (0-indexed) fetch the connector performed. */
function requestUrl(callIndex = 0): URL {
  const call = mockFetch.mock.calls[callIndex]
  if (!call) throw new Error(`No fetch call at index ${callIndex}`)
  return new URL(String(call[0]))
}

function postFixture(overrides: Record<string, unknown> = {}) {
  return {
    ID: 1,
    title: 'Hello',
    content: '<p>Body</p>',
    URL: 'https://mysite.wordpress.com/2026/01/01/hello/',
    modified: '2026-01-02T00:00:00+00:00',
    type: 'post',
    author: { name: 'Ada' },
    categories: { News: { name: 'News' } },
    tags: { Launch: { name: 'Launch' } },
    ...overrides,
  }
}

describe('wordpress listDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('targets the WordPress.com posts endpoint with a documented page size and field list', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ found: 0, posts: [] }))

    await wordpressConnector.listDocuments(ACCESS_TOKEN, SITE_CONFIG)

    const url = requestUrl()
    expect(url.origin).toBe('https://public-api.wordpress.com')
    expect(url.pathname).toBe('/rest/v1.1/sites/mysite.wordpress.com/posts')
    expect(Number(url.searchParams.get('number'))).toBeLessThanOrEqual(100)
    expect(url.searchParams.get('type')).toBe('any')
    expect(url.searchParams.get('offset')).toBe('0')
    expect(url.searchParams.get('fields')).toContain('modified')
  })

  /**
   * The API builds `meta.next_page` as `value=<sort column>&id=<ID>` and omits the
   * handle entirely when that column is absent from `fields`. Ordering defaults to
   * `date`, so dropping `date` from the projection silently disables the cursor and
   * falls back to offset paging, which re-numbers whenever a post is published.
   */
  it('keeps the default sort column in the projection so page_handle is returned', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ found: 0, posts: [] }))

    await wordpressConnector.listDocuments(ACCESS_TOKEN, SITE_CONFIG)

    expect(requestUrl().searchParams.get('fields')?.split(',')).toContain('date')
  })

  it('normalizes a pasted site URL down to the bare host', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ found: 0, posts: [] }))

    await wordpressConnector.listDocuments(ACCESS_TOKEN, {
      siteUrl: '  https://mysite.wordpress.com/blog/?utm=1  ',
    })

    expect(requestUrl().pathname).toBe('/rest/v1.1/sites/mysite.wordpress.com/posts')
  })

  it('maps postType to the documented type parameter', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ found: 0, posts: [] }))

    await wordpressConnector.listDocuments(ACCESS_TOKEN, { ...SITE_CONFIG, postType: 'Pages' })

    expect(requestUrl().searchParams.get('type')).toBe('page')
  })

  /**
   * WordPress.com renders typographic punctuation as numeric character
   * references, so decoding them is what keeps `’` out of the index as the
   * literal text `&#8217;`. The decode lives in the shared `htmlToPlainText`,
   * which every HTML-sourced connector routes through.
   */
  it('strips rendered HTML and decodes numeric entities in the title', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        found: 1,
        posts: [postFixture({ title: 'Ada&#8217;s <em>launch</em>' })],
      })
    )

    const result = await wordpressConnector.listDocuments(ACCESS_TOKEN, SITE_CONFIG)

    expect(result.documents[0].title).toBe('Ada’s launch')
    expect(result.documents[0].content).not.toContain('<')
  })

  it('flags the listing capped when maxPosts hides posts that still exist', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ found: 10, posts: [postFixture({ ID: 1 })] }))

    const syncContext: Record<string, unknown> = {}
    const result = await wordpressConnector.listDocuments(
      ACCESS_TOKEN,
      { ...SITE_CONFIG, maxPosts: '1' },
      undefined,
      syncContext
    )

    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeUndefined()
    expect(syncContext.listingCapped).toBe(true)
  })

  it('leaves listingCapped unset when the cap lands exactly on source exhaustion', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ found: 1, posts: [postFixture({ ID: 1 })] }))

    const syncContext: Record<string, unknown> = {}
    await wordpressConnector.listDocuments(
      ACCESS_TOKEN,
      { ...SITE_CONFIG, maxPosts: '1' },
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('requests only the remaining posts on the final capped page', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ found: 500, posts: [] }))

    await wordpressConnector.listDocuments(
      ACCESS_TOKEN,
      { ...SITE_CONFIG, maxPosts: '105' },
      undefined,
      {
        totalDocsFetched: 100,
      }
    )

    expect(requestUrl().searchParams.get('number')).toBe('5')
  })

  it('carries the page_handle cursor forward when the response provides one', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        found: 10,
        posts: [postFixture({ ID: 1 })],
        meta: { next_page: 'handle-2' },
      })
    )

    const first = await wordpressConnector.listDocuments(ACCESS_TOKEN, SITE_CONFIG, undefined, {})
    expect(first.hasMore).toBe(true)

    mockFetch.mockResolvedValueOnce(jsonResponse({ found: 10, posts: [] }))
    await wordpressConnector.listDocuments(ACCESS_TOKEN, SITE_CONFIG, first.nextCursor, {})

    expect(requestUrl(1).searchParams.get('page_handle')).toBe('handle-2')
  })

  it('produces the same contentHash from listDocuments and getDocument', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ found: 1, posts: [postFixture()] }))
    const listed = await wordpressConnector.listDocuments(ACCESS_TOKEN, SITE_CONFIG)

    mockFetch.mockResolvedValueOnce(jsonResponse(postFixture()))
    const fetched = await wordpressConnector.getDocument(ACCESS_TOKEN, SITE_CONFIG, '1')

    expect(fetched?.contentHash).toBe(listed.documents[0].contentHash)
  })
})

describe('wordpress getDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null for a missing post', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: 'unknown_post' }, 404))

    await expect(
      wordpressConnector.getDocument(ACCESS_TOKEN, SITE_CONFIG, '99')
    ).resolves.toBeNull()
  })
})

describe('wordpress validateConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects a missing site URL without calling the API', async () => {
    await expect(wordpressConnector.validateConfig(ACCESS_TOKEN, {})).resolves.toEqual({
      valid: false,
      error: 'Site URL is required',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects a non-positive maxPosts', async () => {
    const result = await wordpressConnector.validateConfig(ACCESS_TOKEN, {
      ...SITE_CONFIG,
      maxPosts: '0',
    })

    expect(result.valid).toBe(false)
  })

  it('accepts a reachable site', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ ID: 123, name: 'My Site' }))

    await expect(wordpressConnector.validateConfig(ACCESS_TOKEN, SITE_CONFIG)).resolves.toEqual({
      valid: true,
    })
  })
})
