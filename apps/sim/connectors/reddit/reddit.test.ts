import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { redditConnector } from '@/connectors/reddit/reddit'

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
  it('rejects a subreddit that would reshape the request path', async () => {
    await expect(
      redditConnector.listDocuments(ACCESS_TOKEN, { subreddit: '../api/v1/me' })
    ).rejects.toThrow(/valid subreddit/i)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('reddit deletion-reconciliation safety', () => {
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
})

describe('reddit validateConfig', () => {
  it('checks the about endpoint and rejects private subreddits', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ kind: 't5', data: { display_name: 'testsub', subreddit_type: 'private' } })
    )

    const result = await redditConnector.validateConfig(ACCESS_TOKEN, { subreddit: 'testsub' })
    expect(requestUrl().pathname).toBe('/r/testsub/about')
    expect(result).toEqual({ valid: false, error: 'Subreddit r/testsub is private' })
  })
})
