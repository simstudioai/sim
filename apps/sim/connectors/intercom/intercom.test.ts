/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { intercomConnector } from '@/connectors/intercom/intercom'

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

function articleFixture(id: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'article',
    id,
    title: `Article ${id}`,
    description: null,
    body: `<p>Body ${id}</p>`,
    author_id: 5017691,
    state: 'published',
    created_at: 1672928359,
    updated_at: 1672928610,
    url: `https://help.example.com/articles/${id}`,
    ...overrides,
  }
}

function conversationFixture(id: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'conversation',
    id,
    title: `Conversation ${id}`,
    state: 'open',
    created_at: 1663597223,
    updated_at: 1663597260,
    source: {
      type: 'conversation',
      id: '403918241',
      body: '<p>hello</p>',
      author: { type: 'admin', id: '991', name: 'Ada' },
    },
    tags: { type: 'tag.list', tags: [{ id: '1', name: 'billing' }] },
    ...overrides,
  }
}

beforeEach(() => {
  mockFetch.mockReset()
  vi.stubGlobal('fetch', mockFetch)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('intercom regional base URL', () => {
  it.each([
    ['us', 'api.intercom.io'],
    ['eu', 'api.eu.intercom.io'],
    ['au', 'api.au.intercom.io'],
    [undefined, 'api.intercom.io'],
  ])('routes region %s to %s', async (region, host) => {
    mockFetch.mockResolvedValue(jsonResponse({ data: [], pages: { total_pages: 0 } }))

    await intercomConnector.listDocuments(
      ACCESS_TOKEN,
      { contentType: 'articles', ...(region ? { region } : {}) },
      undefined,
      {}
    )

    expect(requestUrl().host).toBe(host)
  })

  it('sends the pinned Intercom-Version header', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: [], pages: { total_pages: 0 } }))

    await intercomConnector.listDocuments(ACCESS_TOKEN, { contentType: 'articles' }, undefined, {})

    const init = mockFetch.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['Intercom-Version']).toBe('2.11')
  })
})

describe('intercom listingCapped', () => {
  it('leaves listingCapped unset when the source is exhausted', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ data: [articleFixture('1'), articleFixture('2')], pages: { total_pages: 1 } })
    )
    const syncContext: Record<string, unknown> = {}

    const result = await intercomConnector.listDocuments(
      ACCESS_TOKEN,
      { contentType: 'articles', maxItems: '10' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(2)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('leaves listingCapped unset when maxItems lands exactly on exhaustion', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ data: [articleFixture('1'), articleFixture('2')], pages: { total_pages: 1 } })
    )
    const syncContext: Record<string, unknown> = {}

    await intercomConnector.listDocuments(
      ACCESS_TOKEN,
      { contentType: 'articles', maxItems: '2' },
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('flags listingCapped when maxItems hides articles on the same page', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: [articleFixture('1'), articleFixture('2'), articleFixture('3')],
        pages: { total_pages: 1 },
      })
    )
    const syncContext: Record<string, unknown> = {}

    await intercomConnector.listDocuments(
      ACCESS_TOKEN,
      { contentType: 'articles', maxItems: '2' },
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBe(true)
  })

  it('flags listingCapped when conversations remain behind a cursor', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        type: 'conversation.list',
        conversations: [conversationFixture('a'), conversationFixture('b')],
        pages: { type: 'pages', next: { starting_after: 'cursor-1' } },
      })
    )
    const syncContext: Record<string, unknown> = {}

    await intercomConnector.listDocuments(
      ACCESS_TOKEN,
      { contentType: 'conversations', maxItems: '2' },
      undefined,
      syncContext
    )

    expect(syncContext.listingCapped).toBe(true)
  })

  it('does not flag listingCapped for an intentional state filter', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: [articleFixture('1'), articleFixture('2', { state: 'draft' })],
        pages: { total_pages: 1 },
      })
    )
    const syncContext: Record<string, unknown> = {}

    const result = await intercomConnector.listDocuments(
      ACCESS_TOKEN,
      { contentType: 'articles', articleState: 'published', maxItems: '10' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(1)
    expect(syncContext.listingCapped).toBeUndefined()
  })
})

describe('intercom articles pagination', () => {
  it('keeps per_page constant across pages so page-number paging cannot slide', async () => {
    const fullPage = Array.from({ length: 50 }, (_, i) => articleFixture(String(i + 1)))
    mockFetch.mockImplementation(() =>
      Promise.resolve(jsonResponse({ data: fullPage, pages: { total_pages: 3 } }))
    )

    await intercomConnector.listDocuments(
      ACCESS_TOKEN,
      { contentType: 'articles', maxItems: '60' },
      undefined,
      {}
    )

    expect(mockFetch.mock.calls).toHaveLength(2)
    expect(requestUrl(0).searchParams.get('per_page')).toBe('50')
    expect(requestUrl(0).searchParams.get('page')).toBe('1')
    expect(requestUrl(1).searchParams.get('per_page')).toBe('50')
    expect(requestUrl(1).searchParams.get('page')).toBe('2')
  })
})

describe('intercom maxItems budget', () => {
  it('shares one budget across articles and conversations', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (String(url).includes('/articles')) {
        return Promise.resolve(
          jsonResponse({
            data: [articleFixture('1'), articleFixture('2')],
            pages: { total_pages: 1 },
          })
        )
      }
      return Promise.resolve(
        jsonResponse({ conversations: [conversationFixture('a')], pages: { type: 'pages' } })
      )
    })
    const syncContext: Record<string, unknown> = {}

    const result = await intercomConnector.listDocuments(
      ACCESS_TOKEN,
      { contentType: 'both', maxItems: '3' },
      undefined,
      syncContext
    )

    expect(result.documents).toHaveLength(3)
    const conversationCall = mockFetch.mock.calls.find((c) =>
      String(c[0]).includes('/conversations')
    )
    expect(new URL(String(conversationCall?.[0])).searchParams.get('per_page')).toBe('1')
  })
})

describe('intercom contentHash consistency', () => {
  it('matches between the conversation stub and getDocument', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        conversations: [conversationFixture('a')],
        pages: { type: 'pages' },
      })
    )
    const listed = await intercomConnector.listDocuments(
      ACCESS_TOKEN,
      { contentType: 'conversations' },
      undefined,
      {}
    )
    const stub = listed.documents[0]
    expect(stub.contentDeferred).toBe(true)
    expect(stub.content).toBe('')

    mockFetch.mockResolvedValue(
      jsonResponse({
        ...conversationFixture('a'),
        conversation_parts: {
          type: 'conversation_part.list',
          conversation_parts: [
            {
              type: 'conversation_part',
              id: '3',
              part_type: 'comment',
              body: '<p>Okay!</p>',
              created_at: 1663597240,
              author: { type: 'admin', id: '991', name: 'Ada' },
            },
          ],
          total_count: 1,
        },
      })
    )

    const full = await intercomConnector.getDocument(
      ACCESS_TOKEN,
      { contentType: 'conversations' },
      stub.externalId
    )

    expect(full?.contentHash).toBe(stub.contentHash)
    expect(full?.contentDeferred).toBe(false)
    expect(full?.content).toContain('Okay!')
    expect(full?.content).not.toContain('<p>')
    expect(full?.metadata?.messageCount).toBe(2)
  })
})

describe('intercom getDocument error handling', () => {
  it('returns null on 404', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ errors: [{ code: 'not_found' }] }, 404))

    await expect(
      intercomConnector.getDocument(ACCESS_TOKEN, {}, 'conversation-missing')
    ).resolves.toBeNull()
  })

  it('rethrows non-404 failures so the sync engine records them', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ errors: [{ code: 'server_error' }] }, 500))

    await expect(intercomConnector.getDocument(ACCESS_TOKEN, {}, 'conversation-1')).rejects.toThrow(
      /500/
    )
  })
})

describe('intercom mapTags', () => {
  it('only emits tag ids declared in tagDefinitions', async () => {
    const declared = new Set((intercomConnector.tagDefinitions ?? []).map((t) => t.id))
    const mapped = intercomConnector.mapTags?.({
      type: 'conversation',
      state: 'open',
      tags: 'billing',
      authorId: '5017691',
      messageCount: 3,
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    for (const key of Object.keys(mapped ?? {})) {
      expect(declared.has(key)).toBe(true)
    }
    expect(mapped?.updatedAt).toBeInstanceOf(Date)
  })

  it('omits authorId when the article has none', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: [articleFixture('1', { author_id: null })],
        pages: { total_pages: 1 },
      })
    )

    const result = await intercomConnector.listDocuments(
      ACCESS_TOKEN,
      { contentType: 'articles' },
      undefined,
      {}
    )

    expect(result.documents[0].metadata?.authorId).toBeUndefined()
    expect(intercomConnector.mapTags?.(result.documents[0].metadata ?? {})).not.toHaveProperty(
      'authorId'
    )
  })
})
