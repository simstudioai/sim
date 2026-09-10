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
vi.mock('@/lib/knowledge/documents/service', () => ({
  isTriggerAvailable: () => false,
  processDocumentsWithQueue: vi.fn(),
}))
vi.mock('@/lib/knowledge/connectors/sync-persistence', () => ({
  addDocument: vi.fn(),
  persistSkippedDocuments: vi.fn(),
  persistSkippedRetryHashes: vi.fn(),
  updateDocument: vi.fn(),
}))

import {
  classifyExternalDoc,
  mergeHydratedSkippedDocument,
  shouldReplaceExistingWithSkippedDocument,
} from '@/lib/knowledge/connectors/sync-primitives'
import { gmailConnector } from '@/connectors/gmail/gmail'
import { DEFAULT_MAX_THREADS, gmailConnectorMeta } from '@/connectors/gmail/meta'
import {
  CONNECTOR_TEXT_DOCUMENT_MAX_BYTES,
  memberDocumentId,
  PER_MEMBER_LISTING_CONTEXT,
} from '@/connectors/utils'

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

  it('hydrates a thread that becomes small enough during the bounded retry', async () => {
    let fullReads = 0
    mockFetchWithRetry.mockImplementation(async (url: string) => {
      const parsed = new URL(url)
      if (parsed.pathname.endsWith('/labels')) return Response.json({ labels: [] })
      if (parsed.searchParams.get('format') === 'minimal')
        return Response.json({ id: 'thread-1', historyId: '11' })
      if (fullReads++ === 0)
        return new Response(null, {
          headers: { 'Content-Length': String(32 * 1024 * 1024 + 1) },
        })
      return Response.json(threadFixture('11', 'A smaller current thread'))
    })
    const document = await gmailConnector.getDocument('token', {}, 'thread-1')
    expect(document?.content).toContain('A smaller current thread')
    expect(document?.skippedReason).toBeUndefined()
    expect(document?.contentHash).toBe('gmail:thread-1:11:body-v2')
    expect(fullReads).toBe(2)
  })

  it.each([401, 429, 503])(
    'preserves metadata HTTP %s failure instead of caching a skip',
    async (status) => {
      mockFetchWithRetry.mockImplementation(async (url: string) =>
        new URL(url).searchParams.get('format') === 'minimal'
          ? new Response(null, { status })
          : new Response(null, {
              headers: { 'Content-Length': String(32 * 1024 * 1024 + 1) },
            })
      )
      await expect(gmailConnector.getDocument('token', {}, 'thread-1')).rejects.toMatchObject({
        status,
      })
      expect(mockFetchWithRetry).toHaveBeenCalledTimes(2)
    }
  )

  it.each([{}, { id: 'thread-1' }, { id: 'other-thread', historyId: '10' }])(
    'rejects unverified metadata instead of synthesizing a skip revision: %j',
    async (metadata) => {
      mockFetchWithRetry.mockImplementation(async (url: string) =>
        new URL(url).searchParams.get('format') === 'minimal'
          ? Response.json(metadata)
          : new Response(null, {
              headers: { 'Content-Length': String(32 * 1024 * 1024 + 1) },
            })
      )
      await expect(gmailConnector.getDocument('token', {}, 'thread-1')).rejects.toThrow(
        'Gmail returned malformed thread metadata'
      )
      expect(mockFetchWithRetry).toHaveBeenCalledTimes(2)
    }
  )

  it('returns null when the oversized thread disappears before revision verification', async () => {
    mockFetchWithRetry.mockImplementation(async (url: string) =>
      new URL(url).searchParams.get('format') === 'minimal'
        ? new Response(null, { status: 404 })
        : new Response(null, {
            headers: { 'Content-Length': String(32 * 1024 * 1024 + 1) },
          })
    )
    await expect(gmailConnector.getDocument('token', {}, 'thread-1')).resolves.toBeNull()
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(2)
  })

  it('does not turn a missing response body into a permanent size skip', async () => {
    mockFetchWithRetry.mockResolvedValueOnce(new Response(null))
    await expect(gmailConnector.getDocument('token', {}, 'thread-1')).rejects.toThrow()
    expect(mockFetchWithRetry).toHaveBeenCalledTimes(1)
  })

  it('hydrates all ordinary replies from a chunked response', async () => {
    const first = threadFixture('12', 'First message 世界')
    const reply = threadFixture('12', 'Second reply with details').messages[0]
    const thread = {
      ...first,
      messages: [...first.messages, { ...reply, id: 'message-2' }],
    }
    const data = Buffer.from(JSON.stringify(thread))
    let offset = 0
    mockFetchWithRetry.mockImplementation(async (url: string) => {
      if (url.endsWith('/labels')) return Response.json({ labels: [] })
      return new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(data.subarray(offset, offset + 31))
            offset += 31
            if (offset >= data.length) controller.close()
          },
        })
      )
    })

    const document = await gmailConnector.getDocument('token', {}, 'thread-1')

    expect(document).toMatchObject({
      title: 'A conversation',
      contentHash: 'gmail:thread-1:12:body-v2',
      contentDeferred: false,
      metadata: { messageCount: 2 },
    })
    expect(document?.content).toContain('First message 世界')
    expect(document?.content).toContain('Second reply with details')
    expect(document?.skippedReason).toBeUndefined()
  })
})

describe('Gmail separately stored message bodies', () => {
  it('retrieves the selected plain body using the message ID and current member token', async () => {
    const text = 'Private body 世界'
    const bodyRequests = mockExternalBodyThread(
      {
        mimeType: 'multipart/alternative',
        parts: [
          {
            mimeType: 'text/html',
            body: { data: Buffer.from('HTML fallback').toString('base64url') },
          },
          {
            mimeType: 'text/plain',
            filename: '',
            body: { attachmentId: 'body/id+1', size: Buffer.byteLength(text) },
          },
        ],
      },
      () =>
        Response.json({
          data: Buffer.from(text).toString('base64url'),
          size: Buffer.byteLength(text),
        })
    )

    const document = await gmailConnector.getDocument(
      'alice-token',
      {},
      'member:alice:thread-1',
      memberContext('alice')
    )

    expect(document?.content).toContain(text)
    expect(document?.content).not.toContain('HTML fallback')
    expect(document?.contentHash).toBe('gmail:thread-1:10:body-v2')
    expect(document?.externalId).toBe('member:alice:thread-1')
    expect(bodyRequests).toHaveLength(1)
    expect(bodyRequests[0].pathname).toBe(
      '/gmail/v1/users/me/messages/message-1/attachments/body%2Fid%2B1'
    )
    expect(bodyRequests[0].searchParams.get('fields')).toBe('data,size')
    expect(mockFetchWithRetry).toHaveBeenCalledWith(bodyRequests[0].toString(), {
      method: 'GET',
      headers: { Authorization: 'Bearer alice-token', Accept: 'application/json' },
    })
  })

  it('extracts a nested external HTML body without fetching file or binary parts', async () => {
    const html = '<p>Hello <strong>世界</strong></p>'
    const bodyRequests = mockExternalBodyThread(
      {
        mimeType: 'multipart/mixed',
        parts: [
          {
            mimeType: 'text/plain',
            filename: 'private.txt',
            body: { attachmentId: 'private-file' },
          },
          { mimeType: 'image/png', body: { attachmentId: 'inline-image' } },
          {
            mimeType: 'multipart/mixed',
            filename: 'attached-email.eml',
            parts: [{ mimeType: 'text/plain', body: { attachmentId: 'attached-email-body' } }],
          },
          {
            mimeType: 'multipart/alternative',
            parts: [{ mimeType: 'text/html', body: { attachmentId: 'html-body' } }],
          },
        ],
      },
      () =>
        Response.json({
          data: Buffer.from(html).toString('base64url'),
          size: Buffer.byteLength(html),
        })
    )

    const document = await gmailConnector.getDocument('token', {}, 'thread-1')

    expect(document?.content).toContain('Hello 世界')
    expect(document?.content).not.toContain('<strong>')
    expect(bodyRequests.map((url) => url.pathname.split('/').at(-1))).toEqual(['html-body'])
  })

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
      expect(error).toMatchObject({ message: `Failed to fetch Gmail message body: ${status}` })
      expect(gmailConnector.isCredentialInvalidError?.(error)).toBe(status === 401)
    }
  )

  it('preserves an exhausted provider retry error for the sync scheduler', async () => {
    const retryError = Object.assign(new Error('Gmail temporarily unavailable'), {
      status: 429,
      retryAfterMs: 60_000,
    })
    mockExternalBodyThread({ mimeType: 'text/plain', body: { attachmentId: 'body' } }, () =>
      Promise.reject(retryError)
    )

    await expect(gmailConnector.getDocument('token', {}, 'thread-1')).rejects.toBe(retryError)
  })

  it.each([
    { size: 12 },
    { data: 'aGVsbG8', size: 12 },
    { data: 'invalid!base64', size: 9 },
    { data: 'A', size: 0 },
    { data: 'aGVsbG8', size: -1 },
  ])('rejects missing or malformed fetched body data (%j)', async (body) => {
    mockExternalBodyThread({ mimeType: 'text/plain', body: { attachmentId: 'body' } }, () =>
      Response.json(body)
    )

    await expect(gmailConnector.getDocument('token', {}, 'thread-1')).rejects.toThrow(
      'Gmail returned malformed message body data'
    )
  })

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

  it('fails missing response bodies without permanently marking the thread oversized', async () => {
    mockExternalBodyThread(
      { mimeType: 'text/plain', body: { attachmentId: 'body' } },
      () => new Response(null)
    )

    await expect(gmailConnector.getDocument('token', {}, 'thread-1')).rejects.toThrow()
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
  it('preserves the member OAuth path separately from service-account indexing', () => {
    expect(gmailConnectorMeta.search).toBe(true)
    expect(gmailConnectorMeta.auth).toMatchObject({
      mode: 'oauth',
      provider: 'google-email',
      requiredScopes: ['https://www.googleapis.com/auth/gmail.modify'],
    })
    expect(gmailConnectorMeta.permissionScopedListing).toEqual({ capFieldIds: ['maxThreads'] })
    expect(gmailConnectorMeta.mirrorsSourceAcls).toBe(true)
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
      contentHash: 'gmail:thread-1:10:body-v2',
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
    expect(result.documents[0].contentHash).toBe('gmail:thread-1:12:body-v2')
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
      currentCursor: expect.any(String),
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

  it.each([{}, { resultSizeEstimate: 0 }, { threads: [], resultSizeEstimate: 0 }])(
    'completes a valid empty JSON listing without requiring an estimate: %j',
    async (body) => {
      mockFetchWithRetry.mockResolvedValueOnce(Response.json(body))
      const context: Record<string, unknown> = {}
      expect(await gmailConnector.listDocuments('token', {}, undefined, context)).toEqual({
        currentCursor: expect.any(String),
        documents: [],
        hasMore: false,
        nextCursor: undefined,
      })
      expect(context.listingCapped).toBeUndefined()
    }
  )

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
      if (parsed.pathname.endsWith('/profile')) return Response.json({ historyId: '500' })
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

  it('opens the feed at the mailbox history id from the profile', async () => {
    const requests = mockFeed([], {})
    const cursor = await gmailConnector.getChangeCursor!('token', {})
    expect(JSON.parse(cursor)).toEqual({ historyId: '500' })
    expect(requests.map((url) => url.pathname.split('/').at(-1))).toEqual(['profile'])
  })

  it('refuses the feed only when a free-form search filter is configured', () => {
    expect(gmailConnector.supportsChangeFeed!({})).toBe(true)
    expect(gmailConnector.supportsChangeFeed!({ label: 'INBOX', dateRange: '30d' })).toBe(true)
    expect(gmailConnector.supportsChangeFeed!({ query: '   ' })).toBe(true)
    expect(gmailConnector.supportsChangeFeed!({ query: 'from:boss@example.com' })).toBe(false)
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

  it('applies the date range, label and category filters to each message', async () => {
    const dayMs = 24 * 60 * 60 * 1000
    const recent = String(Date.now() - 2 * dayMs)
    const stale = String(Date.now() - 40 * dayMs)
    mockFeed(
      [historyPage(['old', 'promo', 'unlabelled', 'match'])],
      {
        old: metadataThread('old', [{ labelIds: ['Label_7'], internalDate: stale }]),
        promo: metadataThread('promo', [
          { labelIds: ['Label_7', 'CATEGORY_PROMOTIONS'], internalDate: recent },
        ]),
        unlabelled: metadataThread('unlabelled', [{ labelIds: ['INBOX'], internalDate: recent }]),
        match: metadataThread('match', [
          { labelIds: ['INBOX'], internalDate: stale },
          { labelIds: ['Label_7'], internalDate: recent },
        ]),
      },
      [{ id: 'Label_7', name: 'Engineering' }]
    )
    const page = await gmailConnector.listChanges!(
      'token',
      { label: 'Engineering', dateRange: '30d' },
      JSON.stringify({ historyId: '500' })
    )
    const byId = Object.fromEntries(page.changes.map((change) => [change.externalId, change.kind]))
    expect(byId).toEqual({
      old: 'removed',
      promo: 'removed',
      unlabelled: 'removed',
      match: 'upsert',
    })
  })

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
