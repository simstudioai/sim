/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { redditConnector } from '@/connectors/reddit/reddit'
import { REDDIT_USER_AGENT } from '@/tools/reddit/constants'

const ACCESS_TOKEN = 'test-token'

const mockFetch = vi.fn()

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function requestUrl(callIndex = 0): URL {
  const call = mockFetch.mock.calls[callIndex]
  if (!call) throw new Error(`No fetch call at index ${callIndex}`)
  return new URL(String(call[0]))
}

function postFixture(id: string, overrides: Record<string, unknown> = {}) {
  return {
    kind: 't3',
    data: {
      id,
      name: `t3_${id}`,
      title: `Post ${id}`,
      selftext: 'body text',
      author: 'alice',
      score: 10,
      num_comments: 2,
      created_utc: 1700000000,
      permalink: `/r/testsub/comments/${id}/post_${id}/`,
      url: `https://www.reddit.com/r/testsub/comments/${id}/`,
      subreddit: 'testsub',
      is_self: true,
      ...overrides,
    },
  }
}

function listing(children: unknown[], after: string | null) {
  return { kind: 'Listing', data: { children, after } }
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reddit listDocuments request shape', () => {
  it('hits oauth.reddit.com with the listing sort, limit and raw_json', async () => {
    mockFetch.mockResolvedValue(jsonResponse(listing([postFixture('a1')], null)))

    await redditConnector.listDocuments(ACCESS_TOKEN, { subreddit: 'r/testsub', sort: 'new' })

    const url = requestUrl()
    expect(url.origin).toBe('https://oauth.reddit.com')
    expect(url.pathname).toBe('/r/testsub/new')
    expect(url.searchParams.get('limit')).toBe('100')
    expect(url.searchParams.get('raw_json')).toBe('1')
    expect(url.searchParams.get('count')).toBe('0')
    expect(url.searchParams.get('t')).toBeNull()
  })

  it('sends the time filter only for the top sort', async () => {
    mockFetch.mockResolvedValue(jsonResponse(listing([postFixture('a1')], null)))

    await redditConnector.listDocuments(ACCESS_TOKEN, {
      subreddit: 'testsub',
      sort: 'top',
      timeFilter: 'month',
    })

    expect(requestUrl().searchParams.get('t')).toBe('month')
  })

  it('sends a descriptive User-Agent and bearer token', async () => {
    mockFetch.mockResolvedValue(jsonResponse(listing([], null)))

    await redditConnector.listDocuments(ACCESS_TOKEN, { subreddit: 'testsub' })

    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>
    expect(headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`)
    expect(headers['User-Agent']).toBe(REDDIT_USER_AGENT)
    expect(REDDIT_USER_AGENT).toMatch(/^web:[\w.-]+:v[\d.]+ \(\+https:\/\//)
  })

  it('rejects a subreddit that would reshape the request path', async () => {
    await expect(
      redditConnector.listDocuments(ACCESS_TOKEN, { subreddit: '../api/v1/me' })
    ).rejects.toThrow(/valid subreddit/i)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('falls back to hot for an unrecognized sort', async () => {
    mockFetch.mockResolvedValue(jsonResponse(listing([], null)))

    await redditConnector.listDocuments(ACCESS_TOKEN, { subreddit: 'testsub', sort: '../about' })

    expect(requestUrl().pathname).toBe('/r/testsub/hot')
  })
})

describe('reddit deletion-reconciliation safety', () => {
  it('leaves listingCapped unset when the listing is genuinely exhausted', async () => {
    mockFetch.mockResolvedValue(jsonResponse(listing([postFixture('a1')], null)))
    const syncContext: Record<string, unknown> = {}

    const result = await redditConnector.listDocuments(
      ACCESS_TOKEN,
      { subreddit: 'testsub' },
      undefined,
      syncContext
    )

    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('leaves listingCapped unset when maxPosts lands exactly on exhaustion', async () => {
    mockFetch.mockResolvedValue(jsonResponse(listing([postFixture('a1'), postFixture('a2')], null)))
    const syncContext: Record<string, unknown> = {}

    await redditConnector.listDocuments(
      ACCESS_TOKEN,
      { subreddit: 'testsub', maxPosts: '2' },
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('flags listingCapped when maxPosts stops a listing that still has posts', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(listing([postFixture('a1'), postFixture('a2')], 't3_a2'))
    )
    const syncContext: Record<string, unknown> = {}

    const result = await redditConnector.listDocuments(
      ACCESS_TOKEN,
      { subreddit: 'testsub', maxPosts: '2' },
      undefined,
      syncContext
    )

    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBe(true)
  })

  it("flags listingCapped when Reddit's ~1000-item listing ceiling ends pagination", async () => {
    const page = Array.from({ length: 100 }, (_, i) => postFixture(`p${i}`))
    mockFetch.mockResolvedValue(jsonResponse(listing(page, null)))
    const syncContext: Record<string, unknown> = {}

    await redditConnector.listDocuments(
      ACCESS_TOKEN,
      { subreddit: 'testsub', maxPosts: '5000' },
      'after:t3_prev:collected:900',
      syncContext
    )

    expect(syncContext.totalDocsFetched).toBe(1000)
    expect(syncContext.listingCapped).toBe(true)
  })

  it('clamps maxPosts to the listing depth ceiling', async () => {
    mockFetch.mockResolvedValue(jsonResponse(listing([postFixture('a1')], null)))
    const syncContext: Record<string, unknown> = {}

    const result = await redditConnector.listDocuments(
      ACCESS_TOKEN,
      { subreddit: 'testsub', maxPosts: '999999' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(1)
    expect(syncContext.listingCapped).toBeUndefined()
  })
})

describe('reddit document mapping', () => {
  it('returns deferred stubs whose hash matches getDocument', async () => {
    const post = postFixture('a1')
    mockFetch.mockResolvedValue(jsonResponse(listing([post], null)))

    const list = await redditConnector.listDocuments(ACCESS_TOKEN, { subreddit: 'testsub' })
    const stub = list.documents[0]
    expect(stub.contentDeferred).toBe(true)
    expect(stub.content).toBe('')
    expect(stub.sourceUrl).toBe(`https://www.reddit.com${post.data.permalink}`)

    mockFetch.mockResolvedValue(
      jsonResponse([
        listing([post], null),
        listing(
          [
            {
              kind: 't1',
              data: { id: 'c1', author: 'bob', body: 'nice', score: 3, created_utc: 1700000100 },
            },
          ],
          null
        ),
      ])
    )

    const full = await redditConnector.getDocument(ACCESS_TOKEN, { subreddit: 'testsub' }, 'a1')
    expect(full?.contentHash).toBe(stub.contentHash)
    expect(full?.contentDeferred).toBe(false)
    expect(full?.content).toContain('body text')
    expect(full?.content).toContain('[bob | score: 3]: nice')
  })

  it('excludes the fuzzed score but tracks edits and comment count in the hash', async () => {
    mockFetch.mockResolvedValue(jsonResponse(listing([postFixture('a1', { score: 999 })], null)))
    const scored = await redditConnector.listDocuments(ACCESS_TOKEN, { subreddit: 'testsub' })

    mockFetch.mockResolvedValue(jsonResponse(listing([postFixture('a1', { score: 1 })], null)))
    const rescored = await redditConnector.listDocuments(ACCESS_TOKEN, { subreddit: 'testsub' })
    expect(rescored.documents[0].contentHash).toBe(scored.documents[0].contentHash)

    mockFetch.mockResolvedValue(
      jsonResponse(listing([postFixture('a1', { edited: 1700009999 })], null))
    )
    const edited = await redditConnector.listDocuments(ACCESS_TOKEN, { subreddit: 'testsub' })
    expect(edited.documents[0].contentHash).not.toBe(scored.documents[0].contentHash)

    mockFetch.mockResolvedValue(
      jsonResponse(listing([postFixture('a1', { num_comments: 77 })], null))
    )
    const commented = await redditConnector.listDocuments(ACCESS_TOKEN, { subreddit: 'testsub' })
    expect(commented.documents[0].contentHash).not.toBe(scored.documents[0].contentHash)
  })

  it('drops removal placeholders and surfaces unexpanded more stubs', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([
        listing([postFixture('a1', { selftext: '[removed]' })], null),
        listing(
          [
            {
              kind: 't1',
              data: { id: 'c1', author: 'bob', body: '[deleted]', score: 1, created_utc: 1 },
            },
            {
              kind: 't1',
              data: { id: 'c2', author: 'carol', body: 'real', score: 4, created_utc: 2 },
            },
            { kind: 'more', data: { count: 42 } },
          ],
          null
        ),
      ])
    )

    const doc = await redditConnector.getDocument(ACCESS_TOKEN, { subreddit: 'testsub' }, 'a1')
    expect(doc?.content).not.toContain('[removed]')
    expect(doc?.content).not.toContain('[deleted]')
    expect(doc?.content).toContain('[carol | score: 4]: real')
    expect(doc?.content).toContain('42 further comments not indexed')
  })

  it('reads the post from the first listing of the two-element comments response', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse([listing([postFixture('a1')], null), listing([], null)])
    )

    const doc = await redditConnector.getDocument(ACCESS_TOKEN, { subreddit: 'testsub' }, 'a1')
    expect(doc?.externalId).toBe('a1')
    expect(requestUrl().pathname).toBe('/r/testsub/comments/a1')
    expect(requestUrl().searchParams.get('depth')).toBe('1')
  })

  it('returns null when the post is gone', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: 'Not Found' }, 404))

    const doc = await redditConnector.getDocument(ACCESS_TOKEN, { subreddit: 'testsub' }, 'gone')
    expect(doc).toBeNull()
  })

  it('throws instead of reporting an empty document when the fetch fails', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: 'Forbidden' }, 403))

    await expect(
      redditConnector.getDocument(ACCESS_TOKEN, { subreddit: 'testsub' }, 'a1')
    ).rejects.toThrow(/403/)
  })

  it('caps indexed comments and reports the remainder as omitted', async () => {
    const comments = Array.from({ length: 20 }, (_, i) => ({
      kind: 't1',
      data: { author: `u${i}`, body: `comment ${i}`, score: i },
    }))
    mockFetch.mockResolvedValue(
      jsonResponse([listing([postFixture('a1')], null), listing(comments, null)])
    )

    const doc = await redditConnector.getDocument(ACCESS_TOKEN, { subreddit: 'testsub' }, 'a1')
    expect(doc?.content).toContain('Top Comments (15):')
    expect(doc?.content).toContain('comment 14')
    expect(doc?.content).not.toContain('comment 15')
    expect(doc?.content).toContain('(5 further comments not indexed)')
  })

  it('maps every declared tag definition', () => {
    const tags = redditConnector.mapTags?.({
      author: 'alice',
      score: 10,
      commentCount: 2,
      flair: 'Discussion',
      postDate: '2026-01-01T00:00:00.000Z',
    })

    const declared = redditConnector.tagDefinitions?.map((tag) => tag.id) ?? []
    expect(Object.keys(tags ?? {}).sort()).toEqual([...declared].sort())
  })
})

describe('reddit validateConfig', () => {
  it('rejects an invalid subreddit before calling the API', async () => {
    const result = await redditConnector.validateConfig(ACCESS_TOKEN, { subreddit: 'a b/c' })
    expect(result.valid).toBe(false)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('checks the about endpoint and rejects private subreddits', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ kind: 't5', data: { display_name: 'testsub', subreddit_type: 'private' } })
    )

    const result = await redditConnector.validateConfig(ACCESS_TOKEN, { subreddit: 'testsub' })
    expect(requestUrl().pathname).toBe('/r/testsub/about')
    expect(result).toEqual({ valid: false, error: 'Subreddit r/testsub is private' })
  })

  it('maps a 404 to a not-found message', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ message: 'Not Found' }, 404))

    const result = await redditConnector.validateConfig(ACCESS_TOKEN, { subreddit: 'testsub' })
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/not found or is not accessible/)
  })

  it('accepts a public subreddit', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ kind: 't5', data: { display_name: 'testsub', subreddit_type: 'public' } })
    )

    expect(await redditConnector.validateConfig(ACCESS_TOKEN, { subreddit: 'testsub' })).toEqual({
      valid: true,
    })
  })
})
