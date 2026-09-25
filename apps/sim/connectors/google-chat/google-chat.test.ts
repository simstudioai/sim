import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { googleChatConnector } from '@/connectors/google-chat/google-chat'

const SPACE_NAME = 'spaces/AAAA1111'

const SPACE = {
  name: SPACE_NAME,
  displayName: 'Platform Team',
  spaceType: 'SPACE' as const,
  spaceUri: 'https://mail.google.com/chat/u/0/#chat/space/AAAA1111',
  lastActiveTime: '2026-02-01T10:30:00Z',
}

const MESSAGES = [
  {
    name: `${SPACE_NAME}/messages/m2`,
    sender: { name: 'users/2', displayName: 'Grace Hopper' },
    createTime: '2026-02-01T10:30:00Z',
    text: 'Shipping today',
  },
  {
    name: `${SPACE_NAME}/messages/m1`,
    sender: { name: 'users/1', displayName: 'Ada Lovelace' },
    createTime: '2026-02-01T10:00:00Z',
    text: 'Morning',
  },
]

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const requestedUrls: string[] = []
const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()

/** Spaces returned by `spaces.list`; per-test overridable. */
let listedSpaces: Record<string, unknown>[] = [SPACE]
/** `nextPageToken` returned by `spaces.list`; per-test overridable. */
let listNextPageToken: string | undefined
/** Messages returned by `spaces.messages.list`; per-test overridable. */
let listedMessages: Record<string, unknown>[] = MESSAGES
/** Space returned by `spaces.list` / `spaces.get`; per-test overridable. */
let fetchedSpace: Record<string, unknown> = SPACE

beforeEach(() => {
  requestedUrls.length = 0
  listedSpaces = [SPACE]
  listNextPageToken = undefined
  listedMessages = MESSAGES
  fetchedSpace = SPACE
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = String(input)
    requestedUrls.push(url)
    if (url.includes('/messages?')) return jsonResponse({ messages: listedMessages })
    if (url.includes('/spaces?')) {
      return jsonResponse({ spaces: listedSpaces, nextPageToken: listNextPageToken })
    }
    if (url.endsWith(`/${SPACE_NAME}`)) return jsonResponse(fetchedSpace)
    return jsonResponse({ error: { message: 'not found' } }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** The decoded `filter` the last `spaces.list` request carried, if any. */
function listFilter(): string | null {
  const listUrl = requestedUrls.find((url) => url.includes('/spaces?'))
  return listUrl ? new URL(listUrl).searchParams.get('filter') : null
}

/** Search params of the first `spaces.messages.list` request. */
function messagesParams(): URLSearchParams {
  const url = requestedUrls.find((requested) => requested.includes('/messages?'))
  if (!url) throw new Error('no messages request was made')
  return new URL(url).searchParams
}

describe('google-chat space scope', () => {
  it('widens the filter to group chats without reaching direct messages', async () => {
    await googleChatConnector.listDocuments('token', { spaceTypes: 'SPACE_AND_GROUP_CHAT' })
    expect(listFilter()).toBe('spaceType = "SPACE" OR spaceType = "GROUP_CHAT"')
  })

  it('rejects an unsupported space type selection', async () => {
    await expect(
      googleChatConnector.validateConfig('token', { spaceTypes: 'DIRECT_MESSAGE' })
    ).resolves.toEqual({ valid: false, error: 'Unsupported space type selection' })
  })
})

describe('google-chat change detection', () => {
  it('re-hydrates every sync when a space has no lastActiveTime', async () => {
    listedSpaces = [{ ...SPACE, lastActiveTime: undefined }]

    const runOne: Record<string, unknown> = {}
    const firstPage = await googleChatConnector.listDocuments('token', {}, undefined, runOne)
    const runTwo: Record<string, unknown> = {}
    const secondPage = await googleChatConnector.listDocuments('token', {}, undefined, runTwo)

    // Stable within a run, so the hydrated document keeps the stub's hash …
    const hydrated = await googleChatConnector.getDocument('token', {}, SPACE_NAME, runOne)
    expect(hydrated?.contentHash).toBe(firstPage.documents[0].contentHash)

    // … and different on the next run, so content never silently goes stale.
    expect(secondPage.documents[0].contentHash).not.toBe(firstPage.documents[0].contentHash)
  })
})

describe('google-chat listing caps', () => {
  it('flags the listing as capped only when the cap truncated a larger source', async () => {
    listedSpaces = [SPACE, { ...SPACE, name: 'spaces/BBBB2222' }]
    const syncContext: Record<string, unknown> = {}

    const result = await googleChatConnector.listDocuments(
      'token',
      { maxSpaces: '1' },
      undefined,
      syncContext
    )
    expect(result.documents).toHaveLength(1)
    expect(result.hasMore).toBe(false)
    expect(syncContext.listingCapped).toBe(true)
  })

  it('stops paginating at the cap even while the source offers another page', async () => {
    listNextPageToken = 'page-2'
    const syncContext: Record<string, unknown> = {}

    const result = await googleChatConnector.listDocuments(
      'token',
      { maxSpaces: '1' },
      undefined,
      syncContext
    )
    expect(result.hasMore).toBe(false)
    expect(result.nextCursor).toBeUndefined()
    expect(syncContext.listingCapped).toBe(true)
  })
})

describe('google-chat empty windows', () => {
  it('returns a document rather than null when the window is empty, so a cleared space does not keep a stale transcript', async () => {
    listedMessages = []
    const doc = await googleChatConnector.getDocument('token', {}, SPACE_NAME)
    expect(doc).not.toBeNull()
    expect(doc?.content).not.toContain('Shipping today')
    expect(doc?.metadata?.messageCount).toBe(0)
  })
})

describe('google-chat message window', () => {
  it('requests messages newest-first so the cap keeps the most recent conversation', async () => {
    await googleChatConnector.getDocument('token', {}, SPACE_NAME)
    expect(messagesParams().get('orderBy')).toBe('createTime DESC')
  })

  it('rehashes when the configured window changes so the stored transcript is refetched', async () => {
    const base = await googleChatConnector.listDocuments('token', {}, undefined, {})
    const narrower = await googleChatConnector.listDocuments(
      'token',
      { maxMessages: '50' },
      undefined,
      {}
    )
    const windowed = await googleChatConnector.listDocuments(
      'token',
      { lookbackDays: '30' },
      undefined,
      {}
    )

    expect(narrower.documents[0].contentHash).not.toBe(base.documents[0].contentHash)
    expect(windowed.documents[0].contentHash).not.toBe(base.documents[0].contentHash)
  })
})
