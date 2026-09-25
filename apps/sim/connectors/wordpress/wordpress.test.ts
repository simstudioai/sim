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
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
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
})
