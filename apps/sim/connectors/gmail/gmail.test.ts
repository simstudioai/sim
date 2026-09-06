/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWithRetry } = vi.hoisted(() => ({ mockFetchWithRetry: vi.fn() }))

vi.mock('@/lib/knowledge/documents/utils', () => ({
  fetchWithRetry: mockFetchWithRetry,
  VALIDATE_RETRY_OPTIONS: {},
}))
vi.mock('@/components/icons', () => ({ GmailIcon: () => null }))

import { gmailConnector } from '@/connectors/gmail/gmail'
import { DEFAULT_MAX_THREADS, gmailConnectorMeta } from '@/connectors/gmail/meta'
import { PER_MEMBER_LISTING_CONTEXT } from '@/connectors/utils'

function threads(count: number, prefix: string) {
  return Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}`, historyId: '1' }))
}

/** Queues thread-list pages in order; each call records the requested URL. */
function mockPages(pages: { threads: unknown[]; nextPageToken?: string }[]) {
  const urls: string[] = []
  let call = 0
  mockFetchWithRetry.mockImplementation(async (url: string) => {
    urls.push(url)
    const page = pages[call++] ?? { threads: [] }
    return {
      ok: true,
      status: 200,
      json: async () => page,
      text: async () => JSON.stringify(page),
    } as unknown as Response
  })
  return urls
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('gmail listDocuments with maxThreads 0 (unlimited, a per-member sync)', () => {
  it('pages past a full page and never marks the listing capped', async () => {
    const urls = mockPages([
      { threads: threads(100, 'a'), nextPageToken: 'page-2' },
      { threads: threads(50, 'b') },
    ])
    const syncContext: Record<string, unknown> = {}

    const first = await gmailConnector.listDocuments(
      'token',
      { maxThreads: 0 },
      undefined,
      syncContext
    )
    expect(first.documents).toHaveLength(100)
    expect(first.hasMore).toBe(true)
    expect(JSON.parse(first.nextCursor!)).toMatchObject({ pageToken: 'page-2' })
    expect(syncContext.listingCapped).toBeUndefined()

    const second = await gmailConnector.listDocuments(
      'token',
      { maxThreads: 0 },
      first.nextCursor,
      syncContext
    )
    expect(second.documents).toHaveLength(50)
    expect(second.hasMore).toBe(false)
    expect(syncContext.totalThreadsFetched).toBe(150)
    expect(syncContext.listingCapped).toBeUndefined()
    expect(urls[1]).toContain('pageToken=page-2')
    expect(urls[1]).toContain('maxResults=100')
  })

  it('still stops and flags a cap that truncates a longer listing', async () => {
    mockPages([{ threads: threads(100, 'a'), nextPageToken: 'page-2' }])
    const syncContext: Record<string, unknown> = {}

    const result = await gmailConnector.listDocuments(
      'token',
      { maxThreads: 100 },
      undefined,
      syncContext
    )
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeUndefined()
    expect(syncContext.listingCapped).toBe(true)
  })
})

describe('Gmail listing checkpoints', () => {
  it('keeps a resumed query fixed when a relative date range crosses midnight', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 1, 23, 59, 59))
    const urls = mockPages([
      { threads: [{ id: 'thread-1', historyId: '10' }], nextPageToken: 'page-2' },
      { threads: [{ id: 'thread-2', historyId: '20' }], nextPageToken: 'page-3' },
      { threads: [] },
    ])
    const sourceConfig = { maxThreads: 0, dateRange: '7d', query: 'from:colleague@example.com' }
    const first = await gmailConnector.listDocuments(
      'token',
      sourceConfig,
      undefined,
      memberContext('alice')
    )
    const initialQuery = new URL(urls[0]).searchParams.get('q')
    expect(initialQuery).toContain('after:2026/08/25')

    vi.setSystemTime(new Date(2026, 8, 2, 0, 0, 1))
    const resumed = await gmailConnector.listDocuments(
      'token',
      sourceConfig,
      first.nextCursor,
      memberContext('alice')
    )
    expect(new URL(urls[1]).searchParams.get('q')).toBe(initialQuery)
    expect(new URL(urls[1]).searchParams.get('pageToken')).toBe('page-2')
    expect(JSON.parse(resumed.nextCursor!)).toEqual({
      pageToken: 'page-3',
      searchQuery: initialQuery,
    })

    await gmailConnector.listDocuments('token', sourceConfig, undefined, memberContext('alice'))
    expect(new URL(urls[2]).searchParams.get('q')).toContain('after:2026/08/26')
  })

  it('resumes with the saved label query rather than resolving a renamed label again', async () => {
    const threadQueries: string[] = []
    let labelRequests = 0
    mockFetchWithRetry.mockImplementation(async (url: string) => {
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/labels')) {
        labelRequests += 1
        return Response.json({
          labels: [{ id: 'Label_7', name: labelRequests === 1 ? 'Engineering' : 'Operations' }],
        })
      }
      threadQueries.push(parsed.searchParams.get('q') ?? '')
      return Response.json({
        threads: [],
        ...(threadQueries.length === 1 ? { nextPageToken: 'page-2' } : {}),
      })
    })
    const sourceConfig = { label: ['Label_7'] }
    const first = await gmailConnector.listDocuments('token', sourceConfig, undefined, {})
    await gmailConnector.listDocuments('token', sourceConfig, first.nextCursor, {})

    expect(labelRequests).toBe(1)
    expect(threadQueries[0]).toContain('label:Engineering')
    expect(threadQueries[1]).toBe(threadQueries[0])
  })

  it('preserves an intentionally empty query in its checkpoint', async () => {
    const urls = mockPages([{ threads: [], nextPageToken: 'page-2' }, { threads: [] }])
    const sourceConfig = { excludePromotions: 'false', excludeSocial: 'false' }
    const first = await gmailConnector.listDocuments('token', sourceConfig)
    expect(JSON.parse(first.nextCursor!)).toEqual({ pageToken: 'page-2', searchQuery: '' })

    await gmailConnector.listDocuments('token', sourceConfig, first.nextCursor)
    expect(new URL(urls[1]).searchParams.has('q')).toBe(false)
    expect(new URL(urls[1]).searchParams.get('pageToken')).toBe('page-2')
  })

  it('still accepts a legacy raw page token and upgrades the next checkpoint', async () => {
    const urls = mockPages([{ threads: [], nextPageToken: 'page-3' }])
    const result = await gmailConnector.listDocuments('token', {}, 'page-2')

    expect(new URL(urls[0]).searchParams.get('pageToken')).toBe('page-2')
    expect(JSON.parse(result.nextCursor!)).toEqual({
      pageToken: 'page-3',
      searchQuery: new URL(urls[0]).searchParams.get('q'),
    })
  })
})

describe('gmail listDocuments with a blank maxThreads', () => {
  it.each([null, '', '   '])('keeps the default cap for %j', async (maxThreads) => {
    mockPages([])
    const syncContext: Record<string, unknown> = { totalThreadsFetched: DEFAULT_MAX_THREADS }

    const result = await gmailConnector.listDocuments(
      'token',
      { maxThreads },
      undefined,
      syncContext
    )

    expect(result.hasMore).toBe(false)
    expect(mockFetchWithRetry).not.toHaveBeenCalled()
  })
})

describe('gmail validateConfig maxThreads', () => {
  it('refuses what the sync parser would refuse, before any request', async () => {
    for (const maxThreads of ['1.5', 'abc', '-1']) {
      const result = await gmailConnector.validateConfig('token', { maxThreads })
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Max threads must be a non-negative whole number')
    }
    expect(mockFetchWithRetry).not.toHaveBeenCalled()
  })
})

function memberContext(memberId: string): Record<string, unknown> {
  return { ...PER_MEMBER_LISTING_CONTEXT, memberId }
}

function threadFixture(historyId = '10', body = 'Private mailbox content') {
  return {
    id: 'thread-1',
    historyId,
    messages: [
      {
        id: 'message-1',
        threadId: 'thread-1',
        internalDate: '1700000000000',
        labelIds: ['INBOX'],
        payload: {
          mimeType: 'text/plain',
          headers: [
            { name: 'Subject', value: 'A conversation' },
            { name: 'From', value: 'colleague@example.com' },
          ],
          body: { data: Buffer.from(body).toString('base64url') },
        },
      },
    ],
  }
}

function mockThreadResponse(thread = threadFixture()) {
  mockFetchWithRetry.mockImplementation(async (url: string) => {
    if (new URL(url).pathname.endsWith('/labels')) {
      return Response.json({ labels: [{ id: 'INBOX', name: 'INBOX', type: 'system' }] })
    }
    return Response.json(thread)
  })
}

describe('Gmail Search member isolation', () => {
  it('offers only the existing member account access path', () => {
    expect(gmailConnectorMeta.search).toBe(true)
    expect(gmailConnectorMeta.auth).toEqual({
      mode: 'oauth',
      provider: 'google-email',
      requiredScopes: ['https://www.googleapis.com/auth/gmail.modify'],
    })
    expect(gmailConnectorMeta.permissionScopedListing).toEqual({ capFieldIds: ['maxThreads'] })
    expect(gmailConnectorMeta.mirrorsSourceAcls).toBeUndefined()
    expect(gmailConnectorMeta.supportsSeparateContentCredential).toBeUndefined()
  })

  it('keeps the same provider thread in different members separate', async () => {
    mockPages([
      { threads: [{ id: 'thread-1', historyId: '10' }] },
      { threads: [{ id: 'thread-1', historyId: '10' }] },
    ])
    const alice = await gmailConnector.listDocuments(
      'alice-token',
      {},
      undefined,
      memberContext('alice')
    )
    const bob = await gmailConnector.listDocuments('bob-token', {}, undefined, memberContext('bob'))

    expect(alice.documents[0].externalId).toBe('member:alice:thread-1')
    expect(bob.documents[0].externalId).toBe('member:bob:thread-1')
    expect(alice.documents[0].externalId).not.toBe(bob.documents[0].externalId)
  })

  it('hydrates only the current member namespace and keeps the provider ID in its URL', async () => {
    mockThreadResponse()
    const document = await gmailConnector.getDocument(
      'alice-token',
      {},
      'member:alice:thread-1',
      memberContext('alice')
    )

    expect(document).toMatchObject({
      externalId: 'member:alice:thread-1',
      contentHash: 'gmail:thread-1:10',
      contentDeferred: false,
      sourceUrl: 'https://mail.google.com/mail/u/0/#all/thread-1',
    })
    expect(document?.content).toContain('Private mailbox content')
    expect(mockFetchWithRetry.mock.calls[0][0]).toContain('/threads/thread-1?format=full')
  })

  it.each(['member:bob:thread-1', 'thread-1'])(
    'does not fetch an external ID outside the current member namespace: %s',
    async (externalId) => {
      const document = await gmailConnector.getDocument(
        'alice-token',
        {},
        externalId,
        memberContext('alice')
      )
      expect(document).toBeNull()
      expect(mockFetchWithRetry).not.toHaveBeenCalled()
    }
  )

  it('preserves general knowledge base document IDs', async () => {
    mockPages([{ threads: [{ id: 'thread-1', historyId: '10' }] }])
    const listing = await gmailConnector.listDocuments('token', {})
    mockThreadResponse()
    const document = await gmailConnector.getDocument('token', {}, listing.documents[0].externalId)

    expect(listing.documents[0].externalId).toBe('thread-1')
    expect(document?.externalId).toBe('thread-1')
    expect(document?.contentHash).toBe(listing.documents[0].contentHash)
  })

  it('refuses to resolve one mailbox custom label ID against another mailbox', async () => {
    await expect(
      gmailConnector.listDocuments(
        'token',
        { label: ['Label_7'] },
        undefined,
        memberContext('alice')
      )
    ).rejects.toThrow('Use Gmail label names')
    expect(mockFetchWithRetry).not.toHaveBeenCalled()
  })

  it('accepts label names that each member resolves in their own mailbox', async () => {
    mockFetchWithRetry.mockImplementation(async (url: string) => {
      if (new URL(url).pathname.endsWith('/labels')) {
        return Response.json({ labels: [{ id: 'Label_91', name: 'Engineering', type: 'user' }] })
      }
      expect(new URL(url).searchParams.get('q')).toContain('label:Engineering')
      return Response.json({ threads: [] })
    })
    await expect(
      gmailConnector.listDocuments(
        'token',
        { label: ['Engineering'] },
        undefined,
        memberContext('alice')
      )
    ).resolves.toMatchObject({ documents: [], hasMore: false })
  })
})

describe('Gmail thread revisions and deferred content', () => {
  it('detects new replies using the thread history revision without downloading content during listing', async () => {
    const urls = mockPages([
      { threads: [{ id: 'thread-1', historyId: '10' }] },
      { threads: [{ id: 'thread-1', historyId: '11' }] },
    ])
    const first = await gmailConnector.listDocuments('token', {})
    const second = await gmailConnector.listDocuments('token', {})
    expect(first.documents[0].contentHash).not.toBe(second.documents[0].contentHash)
    expect(first.documents[0]).toMatchObject({ content: '', contentDeferred: true })
    expect(urls.every((url) => new URL(url).pathname.endsWith('/threads'))).toBe(true)

    mockThreadResponse(threadFixture('11', 'A new reply'))
    const document = await gmailConnector.getDocument('token', {}, 'thread-1')
    expect(document?.contentHash).toBe(second.documents[0].contentHash)
    expect(document?.content).toContain('A new reply')
  })

  it('recovers missing history metadata with a minimal request before classifying changes', async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce(Response.json({ threads: [{ id: 'thread-1' }] }))
      .mockResolvedValueOnce(Response.json({ id: 'thread-1', historyId: '12' }))
    const result = await gmailConnector.listDocuments('token', {})
    expect(result.documents[0].contentHash).toBe('gmail:thread-1:12')
    const metadataUrl = new URL(mockFetchWithRetry.mock.calls[1][0])
    expect(metadataUrl.searchParams.get('format')).toBe('minimal')
    expect(metadataUrl.searchParams.get('fields')).toBe('id,historyId,snippet')
    expect(result.documents[0].contentDeferred).toBe(true)
  })

  it('limits missing-metadata reads to five at a time', async () => {
    let active = 0
    let peak = 0
    mockFetchWithRetry.mockImplementation(async (url: string) => {
      const pathname = new URL(url).pathname
      if (pathname.endsWith('/threads')) {
        return Response.json({
          threads: Array.from({ length: 12 }, (_, index) => ({ id: `thread-${index}` })),
        })
      }
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      active -= 1
      return Response.json({ id: pathname.split('/').at(-1), historyId: '12' })
    })
    const result = await gmailConnector.listDocuments('token', {})
    expect(result.documents).toHaveLength(12)
    expect(peak).toBe(5)
  })

  it.each([401, 403, 429, 503])(
    'fails a partial metadata listing on HTTP %i so deletions cannot reconcile',
    async (status) => {
      mockFetchWithRetry
        .mockResolvedValueOnce(Response.json({ threads: [{ id: 'thread-1' }] }))
        .mockResolvedValueOnce(new Response(null, { status }))
      await expect(gmailConnector.listDocuments('token', {}, undefined, {})).rejects.toThrow(
        `Failed to fetch thread thread-1: ${status}`
      )
    }
  )

  it('allows an already deleted thread to disappear from a complete listing', async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce(Response.json({ threads: [{ id: 'thread-1' }] }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    const context: Record<string, unknown> = {}
    expect(await gmailConnector.listDocuments('token', {}, undefined, context)).toEqual({
      documents: [],
      hasMore: false,
      nextCursor: undefined,
    })
    expect(context.listingCapped).toBeUndefined()
  })

  it.each([
    null,
    { threads: null },
    { threads: [{}] },
    { threads: [{ id: 'thread-1', historyId: 1 }] },
    { threads: [], nextPageToken: 123 },
  ])(
    'rejects malformed listing metadata instead of claiming a complete empty mailbox: %j',
    async (body) => {
      mockFetchWithRetry.mockResolvedValueOnce(Response.json(body))
      await expect(gmailConnector.listDocuments('token', {})).rejects.toThrow(
        'malformed thread listing metadata'
      )
    }
  )

  it('refuses a metadata recovery response without a revision', async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce(Response.json({ threads: [{ id: 'thread-1' }] }))
      .mockResolvedValueOnce(Response.json({ id: 'thread-1' }))
    await expect(gmailConnector.listDocuments('token', {})).rejects.toThrow(
      'malformed thread metadata'
    )
  })

  it('returns null for a removed thread and propagates a transient hydration failure', async () => {
    mockFetchWithRetry.mockResolvedValueOnce(new Response(null, { status: 404 }))
    expect(await gmailConnector.getDocument('token', {}, 'thread-1')).toBeNull()
    mockFetchWithRetry.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await expect(gmailConnector.getDocument('token', {}, 'thread-1')).rejects.toThrow('503')
  })
})

describe('Gmail listing completeness and filters', () => {
  it.each([401, 403, 429, 503])(
    'classifies only a rejected credential as reconnectable for HTTP %i',
    async (status) => {
      mockFetchWithRetry.mockResolvedValueOnce(new Response(null, { status }))
      const error = await gmailConnector.listDocuments('token', {}).catch((cause: unknown) => cause)
      expect(error).toBeInstanceOf(Error)
      expect(gmailConnector.isCredentialInvalidError?.(error)).toBe(status === 401)
    }
  )

  it('continues through an empty page with a continuation token', async () => {
    const urls = mockPages([
      { threads: [], nextPageToken: 'next' },
      { threads: [{ id: 'thread-1', historyId: '10' }] },
    ])
    const context: Record<string, unknown> = {}
    const first = await gmailConnector.listDocuments('token', {}, undefined, context)
    expect(first.hasMore).toBe(true)
    const second = await gmailConnector.listDocuments('token', {}, first.nextCursor, context)
    expect(second.documents).toHaveLength(1)
    expect(new URL(urls[1]).searchParams.get('pageToken')).toBe('next')
    expect(context.listingCapped).toBeUndefined()
  })

  it('requests exactly the remaining cap and reconciles when the source genuinely ends there', async () => {
    const urls = mockPages([{ threads: threads(2, 'thread') }])
    const context: Record<string, unknown> = { totalThreadsFetched: 3 }
    const result = await gmailConnector.listDocuments(
      'token',
      { maxThreads: 5 },
      undefined,
      context
    )
    expect(new URL(urls[0]).searchParams.get('maxResults')).toBe('2')
    expect(result.hasMore).toBe(false)
    expect(context.listingCapped).toBeUndefined()
  })

  it('does not widen configured scope when an additional query contains OR', async () => {
    const urls = mockPages([{ threads: [] }])
    await gmailConnector.listDocuments('token', {
      query: 'from:alice@example.com OR from:bob@example.com',
    })
    expect(new URL(urls[0]).searchParams.get('q')).toBe(
      '-category:promotions -category:social (from:alice@example.com OR from:bob@example.com)'
    )
  })

  it('keeps user label IDs working in a general knowledge base', async () => {
    mockFetchWithRetry
      .mockResolvedValueOnce(
        Response.json({ labels: [{ id: 'Label_7', name: 'Customer Success', type: 'user' }] })
      )
      .mockResolvedValueOnce(Response.json({ threads: [] }))
    await gmailConnector.listDocuments('token', { label: ['Label_7'] })
    expect(new URL(mockFetchWithRetry.mock.calls[1][0]).searchParams.get('q')).toContain(
      'label:"Customer Success"'
    )
  })

  it('fails closed when configured label IDs cannot be resolved', async () => {
    mockFetchWithRetry.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await expect(
      gmailConnector.listDocuments('token', { label: ['INBOX'] }, undefined, {})
    ).rejects.toThrow('cannot resolve the configured label filter')
  })

  it('preserves a credential rejection from the label lookup so a member can reconnect', async () => {
    mockFetchWithRetry.mockResolvedValueOnce(new Response(null, { status: 401 }))
    const error = await gmailConnector
      .listDocuments('token', { label: ['INBOX'] }, undefined, memberContext('alice'))
      .catch((cause: unknown) => cause)
    expect(gmailConnector.isCredentialInvalidError?.(error)).toBe(true)
  })

  it('does not interpret a malformed label response as no matching mail', async () => {
    mockFetchWithRetry.mockResolvedValueOnce(Response.json({}))
    await expect(
      gmailConnector.listDocuments('token', { label: ['Label_7'] }, undefined, {})
    ).rejects.toThrow('cannot resolve the configured label filter')
  })
})

describe('Gmail body and label extraction', () => {
  it('never combines different mailbox views of a thread', async () => {
    mockThreadResponse(threadFixture('10', 'Alice-only reply'))
    const alice = await gmailConnector.getDocument(
      'alice-token',
      {},
      'member:alice:thread-1',
      memberContext('alice')
    )
    mockThreadResponse(threadFixture('10', 'Bob-only reply'))
    const bob = await gmailConnector.getDocument(
      'bob-token',
      {},
      'member:bob:thread-1',
      memberContext('bob')
    )

    expect(alice?.content).toContain('Alice-only reply')
    expect(alice?.content).not.toContain('Bob-only reply')
    expect(bob?.content).toContain('Bob-only reply')
    expect(bob?.content).not.toContain('Alice-only reply')
    expect(alice?.externalId).not.toBe(bob?.externalId)
  })

  it('extracts nested HTML body text and excludes file attachment contents', async () => {
    const thread = threadFixture()
    const payload = {
      mimeType: 'multipart/mixed',
      headers: thread.messages[0].payload.headers,
      parts: [
        {
          mimeType: 'text/plain',
          filename: 'private-attachment.txt',
          body: { data: Buffer.from('Attachment contents').toString('base64url') },
        },
        {
          mimeType: 'multipart/alternative',
          parts: [
            {
              mimeType: 'text/html',
              body: {
                data: Buffer.from('<p>Hello <strong>世界</strong></p>').toString('base64url'),
              },
            },
          ],
        },
      ],
    }
    mockFetchWithRetry.mockImplementation(async (url: string) => {
      if (new URL(url).pathname.endsWith('/labels')) return Response.json({ labels: [] })
      return Response.json({ ...thread, messages: [{ ...thread.messages[0], payload }] })
    })
    const document = await gmailConnector.getDocument('token', {}, 'thread-1')
    expect(document?.content).toContain('Hello 世界')
    expect(document?.content).not.toContain('<strong>')
    expect(document?.content).not.toContain('Attachment contents')
  })

  it('includes labels added on a later reply and reuses the mailbox label cache', async () => {
    const thread = threadFixture()
    thread.messages.push({
      ...thread.messages[0],
      id: 'message-2',
      labelIds: ['Label_7'],
      internalDate: '1700000010000',
    })
    mockFetchWithRetry.mockImplementation(async (url: string) => {
      if (new URL(url).pathname.endsWith('/labels')) {
        return Response.json({
          labels: [
            { id: 'INBOX', name: 'INBOX' },
            { id: 'Label_7', name: 'Engineering' },
          ],
        })
      }
      return Response.json(thread)
    })
    const context = memberContext('alice')
    const first = await gmailConnector.getDocument('token', {}, 'member:alice:thread-1', context)
    await gmailConnector.getDocument('token', {}, 'member:alice:thread-1', context)

    expect(first?.metadata?.labels).toEqual(['INBOX', 'Engineering'])
    expect(first?.metadata?.messageCount).toBe(2)
    expect(gmailConnector.mapTags?.(first?.metadata ?? {})).toMatchObject({
      labels: 'INBOX, Engineering',
      messageCount: 2,
    })
    expect(
      mockFetchWithRetry.mock.calls.filter(([url]) => new URL(url).pathname.endsWith('/labels'))
    ).toHaveLength(1)
  })
})
