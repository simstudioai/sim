/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { googleChatConnector } from '@/connectors/google-chat/google-chat'
import { googleChatConnectorMeta } from '@/connectors/google-chat/meta'

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
  it('filters to named spaces only when spaceTypes is unset', async () => {
    await googleChatConnector.listDocuments('token', {})
    expect(listFilter()).toBe('spaceType = "SPACE"')
  })

  it('filters to named spaces only when spaceTypes is an empty string', async () => {
    await googleChatConnector.listDocuments('token', { spaceTypes: '' })
    expect(listFilter()).toBe('spaceType = "SPACE"')
  })

  it('widens the filter to group chats without reaching direct messages', async () => {
    await googleChatConnector.listDocuments('token', { spaceTypes: 'SPACE_AND_GROUP_CHAT' })
    expect(listFilter()).toBe('spaceType = "SPACE" OR spaceType = "GROUP_CHAT"')
  })

  it('omits the filter only when every conversation type is requested', async () => {
    await googleChatConnector.listDocuments('token', { spaceTypes: 'ALL' })
    expect(listFilter()).toBeNull()
  })

  it('rejects an unsupported space type selection', async () => {
    await expect(
      googleChatConnector.validateConfig('token', { spaceTypes: 'DIRECT_MESSAGE' })
    ).resolves.toEqual({ valid: false, error: 'Unsupported space type selection' })
  })
})

describe('google-chat change detection', () => {
  it('hashes on lastActiveTime and keeps the stub and hydrated hash identical', async () => {
    const syncContext: Record<string, unknown> = {}
    const listed = await googleChatConnector.listDocuments('token', {}, undefined, syncContext)
    const stub = listed.documents[0]
    expect(stub.contentDeferred).toBe(true)
    expect(stub.contentHash).toContain(SPACE.lastActiveTime)

    const hydrated = await googleChatConnector.getDocument('token', {}, SPACE_NAME, syncContext)
    expect(hydrated?.contentHash).toBe(stub.contentHash)
    expect(hydrated?.contentDeferred).toBe(false)
    expect(hydrated?.content).toContain('Ada Lovelace: Morning')
    expect(hydrated?.content).toContain('Grace Hopper: Shipping today')
  })

  it('reuses the listed space rather than re-reading it during hydration', async () => {
    const syncContext: Record<string, unknown> = {}
    await googleChatConnector.listDocuments('token', {}, undefined, syncContext)
    requestedUrls.length = 0

    await googleChatConnector.getDocument('token', {}, SPACE_NAME, syncContext)
    expect(requestedUrls.some((url) => url.endsWith(`/${SPACE_NAME}`))).toBe(false)
  })

  it('produces a stable hash across syncs while lastActiveTime is unchanged', async () => {
    const first = await googleChatConnector.listDocuments('token', {}, undefined, {})
    const second = await googleChatConnector.listDocuments('token', {}, undefined, {})
    expect(second.documents[0].contentHash).toBe(first.documents[0].contentHash)
  })

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

  it('declares rehydrateOnFullSync so edits and deletions are recoverable', () => {
    expect(googleChatConnectorMeta.rehydrateOnFullSync).toBe(true)
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

  it('leaves deletion reconciliation enabled when the source is exhausted at the cap', async () => {
    const syncContext: Record<string, unknown> = {}
    await googleChatConnector.listDocuments('token', { maxSpaces: '1' }, undefined, syncContext)
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('paginates with the returned nextPageToken', async () => {
    listNextPageToken = 'page-2'
    const result = await googleChatConnector.listDocuments('token', {})
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe('page-2')
  })
})

describe('google-chat empty windows', () => {
  it('indexes a space whose only prose is its description when no message has text', async () => {
    fetchedSpace = { ...SPACE, spaceDetails: { description: 'Release coordination' } }
    listedSpaces = [fetchedSpace]
    listedMessages = []

    const doc = await googleChatConnector.getDocument('token', {}, SPACE_NAME)
    expect(doc).not.toBeNull()
    expect(doc?.content).toContain('Release coordination')
  })

  it('indexes a space whose only prose is its guidelines when no message has text', async () => {
    fetchedSpace = { ...SPACE, spaceDetails: { guidelines: 'Be excellent to each other' } }
    listedSpaces = [fetchedSpace]
    listedMessages = []

    const doc = await googleChatConnector.getDocument('token', {}, SPACE_NAME)
    expect(doc?.content).toContain('Be excellent to each other')
  })

  it('returns a document rather than null when the window is empty, so a cleared space does not keep a stale transcript', async () => {
    listedMessages = []
    const doc = await googleChatConnector.getDocument('token', {}, SPACE_NAME)
    expect(doc).not.toBeNull()
    expect(doc?.content).not.toContain('Shipping today')
    expect(doc?.metadata?.messageCount).toBe(0)
  })

  it('omits the transcript header entirely when no message contributed text', async () => {
    listedMessages = []
    const doc = await googleChatConnector.getDocument('token', {}, SPACE_NAME)
    expect(doc?.content).not.toContain('--- Messages ---')
  })

  it('still returns null when the space itself is gone', async () => {
    const doc = await googleChatConnector.getDocument('token', {}, 'spaces/MISSING')
    expect(doc).toBeNull()
  })
})

describe('google-chat message window', () => {
  it('requests messages newest-first so the cap keeps the most recent conversation', async () => {
    await googleChatConnector.getDocument('token', {}, SPACE_NAME)
    expect(messagesParams().get('orderBy')).toBe('createTime DESC')
  })

  it('renders the newest-first page back into chronological order', async () => {
    const doc = await googleChatConnector.getDocument('token', {}, SPACE_NAME)
    const content = doc?.content ?? ''
    expect(content.indexOf('Ada Lovelace')).toBeLessThan(content.indexOf('Grace Hopper'))
  })

  it('bounds the message page to the remaining window rather than the API maximum', async () => {
    await googleChatConnector.getDocument('token', { maxMessages: '5' }, SPACE_NAME)
    expect(messagesParams().get('pageSize')).toBe('5')
  })

  it('sends the lookback cutoff as an RFC-3339 timestamp without fractional seconds', async () => {
    await googleChatConnector.getDocument('token', { lookbackDays: '30' }, SPACE_NAME)
    const filter = messagesParams().get('filter')
    expect(filter).toMatch(/^createTime > "\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z"$/)
  })

  it('omits the filter entirely when no lookback window is configured', async () => {
    await googleChatConnector.getDocument('token', {}, SPACE_NAME)
    expect(messagesParams().get('filter')).toBeNull()
  })

  it('indexes a card-only message through its fallbackText', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url.includes('/messages?')) {
        return jsonResponse({
          messages: [
            {
              name: `${SPACE_NAME}/messages/card`,
              sender: { name: 'users/9', type: 'BOT' },
              createTime: '2026-02-01T09:00:00Z',
              fallbackText: 'Deploy finished',
            },
          ],
        })
      }
      if (url.endsWith(`/${SPACE_NAME}`)) return jsonResponse(SPACE)
      return jsonResponse({}, 404)
    })

    const doc = await googleChatConnector.getDocument('token', {}, SPACE_NAME)
    expect(doc?.content).toContain('Deploy finished')
    expect(doc?.metadata?.messageCount).toBe(1)
  })

  it('labels a sender by resource name when user auth omits displayName', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url.includes('/messages?')) {
        return jsonResponse({
          messages: [
            {
              name: `${SPACE_NAME}/messages/m1`,
              sender: { name: 'users/104512345678', type: 'HUMAN' },
              createTime: '2026-02-01T10:00:00Z',
              text: 'Morning',
            },
          ],
        })
      }
      if (url.endsWith(`/${SPACE_NAME}`)) return jsonResponse(SPACE)
      return jsonResponse({}, 404)
    })

    const doc = await googleChatConnector.getDocument('token', {}, SPACE_NAME)
    expect(doc?.content).toContain('users/104512345678: Morning')
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

describe('google-chat getDocument', () => {
  it('returns null for a space that no longer exists', async () => {
    await expect(googleChatConnector.getDocument('token', {}, 'spaces/MISSING')).resolves.toBeNull()
  })

  it('accepts a bare space id and normalizes it to a resource name', async () => {
    const doc = await googleChatConnector.getDocument('token', {}, 'AAAA1111')
    expect(doc?.externalId).toBe(SPACE_NAME)
  })
})
