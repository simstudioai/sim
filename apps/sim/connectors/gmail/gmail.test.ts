import { knowledgeDocumentsServiceMock } from '@sim/testing/mocks/knowledge-documents-service.mock'
import {
  knowledgeSecureFetchMock,
  knowledgeSecureFetchMockFns,
} from '@sim/testing/mocks/knowledge-secure-fetch.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockFetchWithRetry } = vi.hoisted(() => ({ mockFetchWithRetry: vi.fn() }))

vi.mock('@/lib/knowledge/documents/secure-fetch.server', () => knowledgeSecureFetchMock)
vi.mock('@/connectors/gmail/mailbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/connectors/gmail/mailbox')>()),
  getGmailMailboxEmail: vi.fn(async (token: string) =>
    token === 'bob-token' ? 'bob@example.com' : 'alice@example.com'
  ),
}))
vi.mock('@/lib/knowledge/documents/service', () => knowledgeDocumentsServiceMock)
vi.mock('@/lib/knowledge/connectors/sync-persistence', () => ({
  addDocument: vi.fn(),
  persistSkippedDocuments: vi.fn(),
  persistHashOnlyUpdates: vi.fn(),
  updateDocument: vi.fn(),
}))

import {
  classifyExternalDoc,
  mergeHydratedSkippedDocument,
  shouldReplaceExistingWithSkippedDocument,
} from '@/lib/knowledge/connectors/sync-primitives'
import { gmailConnector } from '@/connectors/gmail/gmail'
import {
  CONNECTOR_TEXT_DOCUMENT_MAX_BYTES,
  memberDocumentId,
  PER_MEMBER_LISTING_CONTEXT,
} from '@/connectors/utils'

knowledgeSecureFetchMockFns.mockFetchWithRetry.mockImplementation(
  (
    url: string,
    init: RequestInit,
    options: {
      fetcher?: (url: string, init: RequestInit, transport: typeof fetch) => Promise<Response>
    }
  ) =>
    options.fetcher ? options.fetcher(url, init, mockFetchWithRetry) : mockFetchWithRetry(url, init)
)

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
    return Response.json(page)
  })
  return urls
}

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
    vi.setSystemTime(new Date('2026-09-01T23:59:59Z'))
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
    expect(initialQuery).toContain(`after:${Date.parse('2026-08-25T23:59:59Z') / 1000}`)

    vi.setSystemTime(new Date('2026-09-02T00:00:01Z'))
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
    expect(new URL(urls[2]).searchParams.get('q')).toContain(
      `after:${Date.parse('2026-08-26T00:00:01Z') / 1000}`
    )
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

function mockExternalBodyThread(
  payload: Record<string, unknown>,
  respond: () => Response | Promise<Response>
) {
  const thread = threadFixture()
  const bodyRequests: URL[] = []
  mockFetchWithRetry.mockImplementation(async (url: string) => {
    const parsed = new URL(url)
    if (parsed.pathname.endsWith('/labels')) return Response.json({ labels: [] })
    if (parsed.pathname.includes('/attachments/')) {
      bodyRequests.push(parsed)
      return respond()
    }
    return Response.json({ ...thread, messages: [{ ...thread.messages[0], payload }] })
  })
  return bodyRequests
}

describe('Gmail full-thread response budget', () => {
  it('records a versioned size skip without reading oversized Content-Length bodies', async () => {
    const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
      controller.enqueue(Buffer.from(JSON.stringify(threadFixture())))
      controller.close()
    })
    const cancel = vi.fn()
    mockFetchWithRetry.mockImplementation(async (url: string) =>
      new URL(url).searchParams.get('format') === 'minimal'
        ? Response.json({ id: 'thread-1', historyId: '10' })
        : new Response(new ReadableStream({ pull, cancel }, { highWaterMark: 0 }), {
            headers: { 'Content-Length': String(32 * 1024 * 1024 + 1) },
          })
    )

    await expect(gmailConnector.getDocument('token', {}, 'thread-1')).resolves.toMatchObject({
      externalId: 'thread-1',
      contentHash: 'gmail:thread-1:10:body-v2',
      content: '',
      contentDeferred: false,
      skippedExistingDisposition: 'replace',
      skippedReason: 'File exceeds the 32MB size limit and was not indexed',
    })
    expect(pull).not.toHaveBeenCalled()
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(4)
  })

  it('cancels chunked oversized JSON and skips only after verifying a stable revision', async () => {
    const chunksRead: number[] = []
    const chunk = Buffer.alloc(1024 * 1024, 'a')
    const cancel = vi.fn()
    mockFetchWithRetry.mockImplementation(async (url: string) => {
      if (new URL(url).searchParams.get('format') === 'minimal')
        return Response.json({ id: 'thread-1', historyId: '10' })
      const index = chunksRead.push(0) - 1
      return new Response(
        new ReadableStream(
          {
            pull(controller) {
              chunksRead[index] += 1
              if (chunksRead[index] === 1) {
                controller.enqueue(
                  Buffer.from('{"id":"thread-1","historyId":"10","messages":[],"padding":"')
                )
              } else if (chunksRead[index] <= 35) {
                controller.enqueue(chunk)
              } else {
                controller.enqueue(Buffer.from('"}'))
                controller.close()
              }
            },
            cancel,
          },
          { highWaterMark: 0 }
        )
      )
    })

    await expect(gmailConnector.getDocument('token', {}, 'thread-1')).resolves.toMatchObject({
      content: '',
      skippedReason: 'File exceeds the 32MB size limit and was not indexed',
      contentHash: 'gmail:thread-1:10:body-v2',
    })
    expect(cancel).toHaveBeenCalledTimes(2)
    expect(chunksRead).toHaveLength(2)
    expect(chunksRead.every((count) => count < 35)).toBe(true)
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(4)
  })

  it('replaces stale content once, resumes on source change, and preserves member isolation', async () => {
    let historyId = '10'
    mockFetchWithRetry.mockImplementation(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url)
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer alice-token')
      if (parsed.pathname.endsWith('/threads'))
        return Response.json({ threads: [{ id: 'thread-1', historyId }] })
      if (parsed.searchParams.get('format') === 'minimal')
        return Response.json({ id: 'thread-1', historyId })
      return new Response(null, {
        headers: { 'Content-Length': String(32 * 1024 * 1024 + 1) },
      })
    })
    const context = memberContext('alice')
    const [stub] = (await gmailConnector.listDocuments('alice-token', {}, undefined, context))
      .documents
    const skipped = await gmailConnector.getDocument('alice-token', {}, stub.externalId, context)
    expect(skipped?.externalId).toBe('member:alice:thread-1')
    expect(shouldReplaceExistingWithSkippedDocument({ storageKey: 'old.txt' }, skipped!)).toBe(true)
    const merged = mergeHydratedSkippedDocument(stub, skipped!)
    const stored = { id: 'stored', contentHash: merged.contentHash, storageKey: null }
    expect(classifyExternalDoc(stub, stored)).toEqual({ type: 'unchanged' })
    expect(classifyExternalDoc(stub, stored, true)).toEqual({
      type: 'update',
      existingId: 'stored',
    })
    historyId = '11'
    const [updated] = (
      await gmailConnector.listDocuments('alice-token', {}, undefined, memberContext('alice'))
    ).documents
    expect(classifyExternalDoc(updated, stored)).toEqual({ type: 'update', existingId: 'stored' })
    mockFetchWithRetry.mockClear()
    expect(
      await gmailConnector.getDocument('alice-token', {}, stub.externalId, memberContext('bob'))
    ).toBeNull()
    expect(mockFetchWithRetry).not.toHaveBeenCalled()
  })

  it('does not cache a size skip for a revision that changes during the bounded retry', async () => {
    let metadataReads = 0
    mockFetchWithRetry.mockImplementation(async (url: string) =>
      new URL(url).searchParams.get('format') === 'minimal'
        ? Response.json({ id: 'thread-1', historyId: String(10 + metadataReads++) })
        : new Response(null, {
            headers: { 'Content-Length': String(32 * 1024 * 1024 + 1) },
          })
    )
    await expect(gmailConnector.getDocument('token', {}, 'thread-1')).rejects.toThrow(
      'Gmail thread changed while checking its size'
    )
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(4)
  })
})

describe('Gmail separately stored message bodies', () => {
  it.each([401, 403, 404])(
    'fails hydration rather than indexing an empty body after HTTP %s',
    async (status) => {
      mockExternalBodyThread(
        { mimeType: 'text/plain', body: { attachmentId: 'body' } },
        () => new Response(null, { status })
      )

      const error = await gmailConnector
        .getDocument('token', {}, 'thread-1')
        .catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(Error)
      expect(error).toMatchObject({
        message: `gmail.messages.attachments.get failed (HTTP ${status}).`,
      })
      expect(gmailConnector.isCredentialInvalidError?.(error)).toBe(status === 401)
    }
  )

  it('skips a known oversized body before downloading it', async () => {
    const bodyRequests = mockExternalBodyThread(
      {
        mimeType: 'text/plain',
        body: { attachmentId: 'body', size: CONNECTOR_TEXT_DOCUMENT_MAX_BYTES + 1 },
      },
      () => {
        throw new Error('Oversized body must not be fetched')
      }
    )

    const document = await gmailConnector.getDocument('token', {}, 'thread-1')

    expect(bodyRequests).toHaveLength(0)
    expect(document).toMatchObject({
      content: '',
      contentDeferred: false,
      skippedReason: 'File exceeds the 12MB size limit and was not indexed',
      skippedExistingDisposition: 'replace',
      skippedRetryPolicy: 'source-change',
    })
  })

  it('cancels an oversized streamed body even when metadata omits its size', async () => {
    const cancel = vi.fn()
    mockExternalBodyThread(
      { mimeType: 'text/plain', body: { attachmentId: 'body' } },
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new Uint8Array(Math.ceil(CONNECTOR_TEXT_DOCUMENT_MAX_BYTES / 3) * 4 + 1025)
              )
            },
            cancel,
          })
        )
    )

    const document = await gmailConnector.getDocument('token', {}, 'thread-1')

    expect(cancel).toHaveBeenCalledOnce()
    expect(document?.content).toBe('')
    expect(document?.skippedReason).toContain('size limit')
  })

  it('applies one body byte budget across the whole thread and stops subsequent downloads', async () => {
    const thread = threadFixture()
    const body = 'x'.repeat(CONNECTOR_TEXT_DOCUMENT_MAX_BYTES / 2 + 1)
    const attachmentRequests: string[] = []
    mockFetchWithRetry.mockImplementation(async (url: string) => {
      if (url.includes('/attachments/')) {
        attachmentRequests.push(url)
        return Response.json({ data: Buffer.from(body).toString('base64url'), size: body.length })
      }
      if (url.endsWith('/labels')) return Response.json({ labels: [] })
      return Response.json({
        ...thread,
        messages: ['first', 'second', 'third'].map((id) => ({
          ...thread.messages[0],
          id,
          payload: { mimeType: 'text/plain', body: { attachmentId: id, size: body.length } },
        })),
      })
    })

    const document = await gmailConnector.getDocument('token', {}, 'thread-1')

    expect(attachmentRequests).toHaveLength(1)
    expect(document?.content).toBe('')
    expect(document?.skippedReason).toContain('size limit')
  })
})

describe('Gmail Search member isolation', () => {
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

  it.each([401, 403, 429, 503])(
    'fails a partial metadata listing on HTTP %i so deletions cannot reconcile',
    async (status) => {
      mockFetchWithRetry
        .mockResolvedValueOnce(Response.json({ threads: [{ id: 'thread-1' }] }))
        .mockResolvedValueOnce(new Response(null, { status }))
      await expect(gmailConnector.listDocuments('token', {}, undefined, {})).rejects.toThrow(
        `gmail.threads.get failed (HTTP ${status}).`
      )
    }
  )

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
})

describe('Gmail listing completeness and filters', () => {
  it('completes a no-match Gmail projection returned as HTTP 204 without parsing a body', async () => {
    const response = new Response(null, { status: 204 })
    const parseBody = vi.spyOn(response, 'json')
    mockFetchWithRetry.mockResolvedValueOnce(response)
    const context: Record<string, unknown> = {}

    expect(
      await gmailConnector.listDocuments(
        'token',
        { query: 'subject:missing-qa-fixture' },
        undefined,
        context
      )
    ).toEqual({
      currentCursor: expect.any(String),
      documents: [],
      hasMore: false,
      nextCursor: undefined,
    })
    expect(context.totalThreadsFetched).toBe(0)
    expect(context.listingCapped).toBeUndefined()
    expect(parseBody).not.toHaveBeenCalled()
  })

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

  it('fails closed when configured label IDs cannot be resolved', async () => {
    mockFetchWithRetry.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await expect(
      gmailConnector.listDocuments('token', { label: ['INBOX'] }, undefined, {})
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
})

describe('Gmail change feed', () => {
  function historyPage(
    threadIds: string[],
    options: { nextPageToken?: string; historyId?: string } = {}
  ) {
    return {
      historyId: options.historyId ?? '900',
      nextPageToken: options.nextPageToken,
      history: threadIds.map((threadId, i) => ({
        id: String(100 + i),
        messages: [{ id: `m-${threadId}`, threadId }],
      })),
    }
  }

  function metadataThread(
    id: string,
    messages: Array<{ labelIds: string[]; internalDate?: string }>,
    historyId = '77'
  ) {
    return {
      id,
      historyId,
      snippet: `Snippet ${id}`,
      messages: messages.map((message, i) => ({
        id: `${id}-m${i}`,
        threadId: id,
        internalDate: message.internalDate ?? String(Date.now()),
        labelIds: message.labelIds,
      })),
    }
  }

  /** Routes history, label and thread reads; a thread id missing from `threads` answers 404. */
  function mockFeed(
    pages: ReturnType<typeof historyPage>[],
    threads: Record<string, ReturnType<typeof metadataThread>>,
    labels: Array<{ id: string; name: string }> = [{ id: 'INBOX', name: 'INBOX' }]
  ) {
    const requests: URL[] = []
    let historyCall = 0
    mockFetchWithRetry.mockImplementation(async (url: string) => {
      const parsed = new URL(url)
      requests.push(parsed)
      if (parsed.pathname.endsWith('/profile'))
        return Response.json({ emailAddress: 'alice@example.com', historyId: '500' })
      if (parsed.pathname.endsWith('/labels')) return Response.json({ labels })
      if (parsed.pathname.endsWith('/history')) {
        return Response.json(pages[historyCall++] ?? historyPage([]))
      }
      const threadId = decodeURIComponent(parsed.pathname.split('/').at(-1) ?? '')
      const thread = threads[threadId]
      return thread ? Response.json(thread) : new Response('not found', { status: 404 })
    })
    return requests
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-10T12:00:00Z'))
  })

  it('upserts changed threads still in scope and removes trashed or deleted ones', async () => {
    const requests = mockFeed([historyPage(['kept', 'trashed', 'gone'])], {
      kept: metadataThread('kept', [{ labelIds: ['INBOX'] }]),
      trashed: metadataThread('trashed', [{ labelIds: ['TRASH'] }, { labelIds: ['SPAM'] }]),
    })
    const syncContext = memberContext('member-a')
    const page = await gmailConnector.listChanges!(
      'token',
      {},
      JSON.stringify({ historyId: '500' }),
      syncContext
    )

    expect(page.hasMore).toBe(false)
    expect(JSON.parse(page.nextCursor)).toEqual({ historyId: '900' })
    expect(page.changes).toHaveLength(3)
    const kept = page.changes.find((change) => change.externalId.endsWith('kept'))
    expect(kept?.kind).toBe('upsert')
    if (kept?.kind !== 'upsert') throw new Error('expected an upsert')
    expect(kept.document.externalId).toBe(memberDocumentId('kept', syncContext))
    expect(kept.document.contentDeferred).toBe(true)
    expect(kept.document.contentHash).toBe('gmail:kept:77:body-v2')
    expect(
      page.changes.filter((change) => change.kind === 'removed').map((c) => c.externalId)
    ).toEqual(
      expect.arrayContaining([
        memberDocumentId('trashed', syncContext),
        memberDocumentId('gone', syncContext),
      ])
    )

    const history = requests.find((url) => url.pathname.endsWith('/history'))!
    expect(history.searchParams.get('startHistoryId')).toBe('500')
    expect(history.searchParams.getAll('historyTypes')).toEqual([
      'messageAdded',
      'messageDeleted',
      'labelAdded',
      'labelRemoved',
    ])
    const threadReads = requests.filter((url) => /\/threads\/[^/]+$/.test(url.pathname))
    expect(threadReads).toHaveLength(3)
    for (const read of threadReads) {
      expect(read.searchParams.get('format')).toBe('metadata')
      expect(read.searchParams.get('fields')).not.toContain('payload')
    }
  })

  it('uses the same timezone-independent cutoff for full listings and history', async () => {
    vi.setSystemTime(new Date('2026-09-10T12:00:00.987Z'))
    const cutoff = new Date('2026-09-03T12:00:00Z').getTime()
    const config = { dateRange: '7d', maxThreads: 0 }
    const urls = mockPages([{ threads: [{ id: 'recent', historyId: '77' }] }])
    const listing = await gmailConnector.listDocuments(
      'token',
      config,
      undefined,
      memberContext('member-a')
    )
    expect(new URL(urls[0]).searchParams.get('q')).toContain(`after:${cutoff / 1000}`)

    mockFeed([historyPage(['earlier-that-day', 'recent'])], {
      'earlier-that-day': metadataThread('earlier-that-day', [
        { labelIds: ['INBOX'], internalDate: String(cutoff - 2 * 60 * 60 * 1000) },
      ]),
      recent: metadataThread('recent', [
        { labelIds: ['INBOX'], internalDate: String(cutoff + 1000) },
      ]),
    })
    const history = await gmailConnector.listChanges!(
      'token',
      config,
      '500',
      memberContext('member-a')
    )
    expect(
      history.changes.filter(({ kind }) => kind === 'upsert').map(({ externalId }) => externalId)
    ).toEqual(listing.documents.map(({ externalId }) => externalId))
    expect(history.changes).toContainEqual({
      kind: 'removed',
      externalId: 'member:member-a:earlier-that-day',
    })
  })

  it.each([403, 503])(
    'does not treat a failed label lookup (%i) as an empty history scope',
    async (status) => {
      mockFetchWithRetry.mockResolvedValueOnce(new Response(null, { status }))
      await expect(
        gmailConnector.listChanges!(
          'token',
          { label: 'Engineering' },
          '500',
          memberContext('member-a')
        )
      ).rejects.toThrow('cannot resolve the configured label filter')
      expect(mockFetchWithRetry).toHaveBeenCalledOnce()
    }
  )

  it('keeps the start history id while paging and advances it once the feed drains', async () => {
    const requests = mockFeed(
      [
        historyPage(['a'], { nextPageToken: 'hp-2', historyId: '901' }),
        historyPage(['b'], { historyId: '902' }),
      ],
      {
        a: metadataThread('a', [{ labelIds: ['INBOX'] }]),
        b: metadataThread('b', [{ labelIds: ['INBOX'] }]),
      }
    )
    const first = await gmailConnector.listChanges!('token', {}, '500')
    expect(first.hasMore).toBe(true)
    expect(JSON.parse(first.nextCursor)).toEqual({ historyId: '500', pageToken: 'hp-2' })

    const second = await gmailConnector.listChanges!('token', {}, first.nextCursor)
    expect(second.hasMore).toBe(false)
    expect(JSON.parse(second.nextCursor)).toEqual({ historyId: '902' })

    const historyReads = requests.filter((url) => url.pathname.endsWith('/history'))
    expect(historyReads.map((url) => url.searchParams.get('startHistoryId'))).toEqual([
      '500',
      '500',
    ])
    expect(historyReads.map((url) => url.searchParams.get('pageToken'))).toEqual([null, 'hp-2'])
  })

  it('reports an expired or malformed cursor so the engine reopens from a full listing', async () => {
    mockFetchWithRetry.mockImplementation(
      async () => new Response('history expired', { status: 404 })
    )
    const expired = await gmailConnector.listChanges!(
      'token',
      {},
      JSON.stringify({ historyId: '1' })
    ).catch((error: unknown) => error)
    expect(gmailConnector.isChangeCursorInvalidError!(expired)).toBe(true)

    const malformed = await gmailConnector.listChanges!('token', {}, 'not-a-cursor').catch(
      (error: unknown) => error
    )
    expect(gmailConnector.isChangeCursorInvalidError!(malformed)).toBe(true)

    mockFetchWithRetry.mockImplementation(async () => new Response('boom', { status: 500 }))
    const outage = await gmailConnector.listChanges!(
      'token',
      {},
      JSON.stringify({ historyId: '1' })
    ).catch((error: unknown) => error)
    expect(gmailConnector.isChangeCursorInvalidError!(outage)).toBe(false)
  })
})
