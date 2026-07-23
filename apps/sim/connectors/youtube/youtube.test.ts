/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  filterAvailableItems,
  type PlaylistItem,
  readTrustedVideoItems,
  youtubeConnector,
} from '@/connectors/youtube/youtube'

const API_KEY = 'test-key'
const PLAYLIST_ID = 'PL123'

function item(videoId: string, title = 'A video'): PlaylistItem {
  return {
    contentDetails: { videoId, videoPublishedAt: '2024-01-01T00:00:00Z' },
    snippet: { title },
  }
}

interface FakeResponseInit {
  status?: number
  body?: unknown
  text?: string
}

function fakeResponse({ status = 200, body, text = '' }: FakeResponseInit): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: { get: () => null },
    json: async () => body,
    text: async () => text,
  } as unknown as Response
}

/** Registers a fetch mock that answers by URL prefix, recording every requested URL. */
function mockFetch(handler: (url: string) => Response): string[] {
  const urls: string[] = []
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input)
    urls.push(url)
    return handler(url)
  })
  vi.stubGlobal('fetch', fetchMock)
  return urls
}

function playlistPage(items: PlaylistItem[], nextPageToken?: string) {
  return { items, ...(nextPageToken ? { nextPageToken } : {}) }
}

function videoListBody(ids: string[], overrides: Record<string, unknown> = {}) {
  return {
    kind: 'youtube#videoListResponse',
    items: ids.map((id) => ({ id })),
    ...overrides,
  }
}

function fullVideo(id: string, duration: string) {
  return {
    id,
    snippet: {
      title: `Video ${id}`,
      description: 'desc',
      publishedAt: '2024-01-01T00:00:00Z',
      channelTitle: 'Chan',
    },
    contentDetails: { duration },
    status: { privacyStatus: 'public' },
  }
}

const listDocuments = youtubeConnector.listDocuments
const getDocument = youtubeConnector.getDocument

describe('filterAvailableItems', () => {
  it('keeps items whose video is present in the availability set', () => {
    const items = [item('aaa'), item('bbb')]
    expect(filterAvailableItems(items, new Set(['aaa', 'bbb']))).toEqual(items)
  })

  it('drops the "Deleted video" placeholder absent from videos.list', () => {
    const live = item('aaa')
    const deleted = item('bbb', 'Deleted video')
    expect(filterAvailableItems([live, deleted], new Set(['aaa']))).toEqual([live])
  })

  it('drops the "Private video" placeholder absent from videos.list', () => {
    const live = item('aaa')
    const priv: PlaylistItem = {
      contentDetails: { videoId: 'bbb' },
      snippet: { title: 'Private video' },
    }
    expect(filterAvailableItems([live, priv], new Set(['aaa']))).toEqual([live])
  })

  it('falls back to snippet.resourceId.videoId when contentDetails is absent', () => {
    const legacy: PlaylistItem = { snippet: { resourceId: { videoId: 'ccc' } } }
    expect(filterAvailableItems([legacy], new Set(['ccc']))).toEqual([legacy])
    expect(filterAvailableItems([legacy], new Set(['aaa']))).toEqual([])
  })

  it('drops items with no resolvable video id', () => {
    expect(filterAvailableItems([{ snippet: { title: 'No id' } }], new Set(['aaa']))).toEqual([])
  })

  it('drops everything when the availability set is empty', () => {
    expect(filterAvailableItems([item('aaa'), item('bbb')], new Set())).toEqual([])
  })

  it('keeps everything when availability is unknown (null)', () => {
    const items = [item('aaa'), item('bbb')]
    expect(filterAvailableItems(items, null)).toEqual(items)
  })

  it('returns an empty list for an empty input', () => {
    expect(filterAvailableItems([], new Set(['aaa']))).toEqual([])
  })

  it('preserves input order and does not mutate the source array', () => {
    const items = [item('aaa'), item('bbb'), item('ccc')]
    const result = filterAvailableItems(items, new Set(['ccc', 'aaa']))
    expect(result.map((i) => i.contentDetails?.videoId)).toEqual(['aaa', 'ccc'])
    expect(items).toHaveLength(3)
  })
})

describe('readTrustedVideoItems', () => {
  it('accepts a well-formed response and returns its items', () => {
    const items = readTrustedVideoItems(videoListBody(['aaa']), ['aaa', 'bbb'])
    expect(items?.map((i) => i.id)).toEqual(['aaa'])
  })

  it('accepts a response with no kind field', () => {
    expect(readTrustedVideoItems({ items: [{ id: 'aaa' }] }, ['aaa'])).toHaveLength(1)
  })

  it('rejects a response whose kind is not a video listing', () => {
    expect(readTrustedVideoItems(videoListBody(['aaa'], { kind: 'youtube#other' }), ['aaa'])).toBe(
      null
    )
  })

  it('rejects a response with a missing or non-array items field', () => {
    expect(readTrustedVideoItems({ kind: 'youtube#videoListResponse' }, ['aaa'])).toBe(null)
    expect(readTrustedVideoItems({ items: 'nope' }, ['aaa'])).toBe(null)
  })

  it('rejects an empty items array when ids were requested', () => {
    expect(readTrustedVideoItems(videoListBody([]), ['aaa'])).toBe(null)
  })

  it('accepts an empty items array when nothing was requested', () => {
    expect(readTrustedVideoItems(videoListBody([]), [])).toEqual([])
  })

  it('rejects entries that are not objects or lack a usable string id', () => {
    expect(readTrustedVideoItems({ items: ['aaa'] }, ['aaa'])).toBe(null)
    expect(readTrustedVideoItems({ items: [null] }, ['aaa'])).toBe(null)
    expect(readTrustedVideoItems({ items: [{ id: 42 }] }, ['aaa'])).toBe(null)
    expect(readTrustedVideoItems({ items: [{ id: '' }] }, ['aaa'])).toBe(null)
    expect(readTrustedVideoItems({ items: [{ snippet: {} }] }, ['aaa'])).toBe(null)
  })

  it('rejects a response containing an id that was never requested', () => {
    expect(readTrustedVideoItems(videoListBody(['zzz']), ['aaa'])).toBe(null)
  })
})

describe('youtubeConnector.listDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves availability with a single id-only videos.list call and drops absent videos', async () => {
    const urls = mockFetch((url) =>
      url.includes('/playlistItems')
        ? fakeResponse({ body: playlistPage([item('aaa'), item('bbb', 'Deleted video')]) })
        : fakeResponse({ body: videoListBody(['aaa']) })
    )

    const result = await listDocuments(API_KEY, { playlistId: PLAYLIST_ID })

    expect(result.documents.map((d) => d.externalId)).toEqual(['aaa'])
    expect(result.hasMore).toBe(false)
    expect(urls).toHaveLength(2)
    expect(urls[1]).toContain('/videos?part=id&id=aaa%2Cbbb')
    expect(urls[1]).toContain('key=test-key')
  })

  it('never zeroes out a page: an availability response omitting every id is untrusted', async () => {
    const urls = mockFetch((url) =>
      url.includes('/playlistItems')
        ? fakeResponse({ body: playlistPage([item('aaa'), item('bbb')], 'TOKEN2') })
        : fakeResponse({ body: videoListBody([]) })
    )

    const syncContext: Record<string, unknown> = {}
    const result = await listDocuments(API_KEY, { playlistId: PLAYLIST_ID }, undefined, syncContext)

    expect(result.documents.map((d) => d.externalId)).toEqual(['aaa', 'bbb'])
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe('TOKEN2')
    expect(urls[1]).toContain('/videos?part=id')
    expect(syncContext.listingTruncated).toBeUndefined()
  })

  it('advances pagination on the real cursor even when most of a page is dropped', async () => {
    mockFetch((url) =>
      url.includes('/playlistItems')
        ? fakeResponse({
            body: playlistPage([item('aaa'), item('bbb'), item('ccc')], 'TOKEN2'),
          })
        : fakeResponse({ body: videoListBody(['aaa']) })
    )

    const syncContext: Record<string, unknown> = {}
    const result = await listDocuments(API_KEY, { playlistId: PLAYLIST_ID }, undefined, syncContext)

    expect(result.documents.map((d) => d.externalId)).toEqual(['aaa'])
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe('TOKEN2')
    expect(syncContext.totalDocsFetched).toBe(1)
  })

  it('fails open and keeps every item when videos.list returns an empty items array', async () => {
    mockFetch((url) =>
      url.includes('/playlistItems')
        ? fakeResponse({ body: playlistPage([item('aaa'), item('bbb')]) })
        : fakeResponse({ body: videoListBody([]) })
    )

    const result = await listDocuments(API_KEY, { playlistId: PLAYLIST_ID })

    expect(result.documents.map((d) => d.externalId)).toEqual(['aaa', 'bbb'])
  })

  it('fails open when videos.list omits the items field entirely', async () => {
    mockFetch((url) =>
      url.includes('/playlistItems')
        ? fakeResponse({ body: playlistPage([item('aaa'), item('bbb')]) })
        : fakeResponse({ body: { kind: 'youtube#videoListResponse' } })
    )

    const result = await listDocuments(API_KEY, { playlistId: PLAYLIST_ID })

    expect(result.documents.map((d) => d.externalId)).toEqual(['aaa', 'bbb'])
  })

  it('fails open when videos.list returns an unexpected kind', async () => {
    mockFetch((url) =>
      url.includes('/playlistItems')
        ? fakeResponse({ body: playlistPage([item('aaa'), item('bbb')]) })
        : fakeResponse({ body: videoListBody(['aaa'], { kind: 'youtube#searchListResponse' }) })
    )

    const result = await listDocuments(API_KEY, { playlistId: PLAYLIST_ID })

    expect(result.documents.map((d) => d.externalId)).toEqual(['aaa', 'bbb'])
  })

  it('fails open when videos.list returns an id that was not requested', async () => {
    mockFetch((url) =>
      url.includes('/playlistItems')
        ? fakeResponse({ body: playlistPage([item('aaa'), item('bbb')]) })
        : fakeResponse({ body: videoListBody(['aaa', 'unrelated']) })
    )

    const result = await listDocuments(API_KEY, { playlistId: PLAYLIST_ID })

    expect(result.documents.map((d) => d.externalId)).toEqual(['aaa', 'bbb'])
  })

  it('throws (aborting the sync, which deletes nothing) when videos.list returns 403', async () => {
    mockFetch((url) =>
      url.includes('/playlistItems')
        ? fakeResponse({ body: playlistPage([item('aaa')]) })
        : fakeResponse({ status: 403, text: 'quotaExceeded' })
    )

    await expect(listDocuments(API_KEY, { playlistId: PLAYLIST_ID })).rejects.toThrow(
      'Failed to batch-fetch YouTube videos: 403'
    )
  })

  it('throws when the playlistItems listing itself fails', async () => {
    mockFetch(() => fakeResponse({ status: 404, text: 'playlistNotFound' }))

    await expect(listDocuments(API_KEY, { playlistId: PLAYLIST_ID })).rejects.toThrow(
      'Failed to list YouTube playlist items: 404'
    )
  })

  it('makes no videos.list call when the page has no usable items', async () => {
    const urls = mockFetch(() => fakeResponse({ body: playlistPage([]) }))

    const result = await listDocuments(API_KEY, { playlistId: PLAYLIST_ID })

    expect(result.documents).toEqual([])
    expect(urls).toHaveLength(1)
  })

  it('hydrates full documents and drops Shorts when excludeShorts is on', async () => {
    const urls = mockFetch((url) =>
      url.includes('/playlistItems')
        ? fakeResponse({ body: playlistPage([item('aaa'), item('bbb'), item('ccc')]) })
        : fakeResponse({
            body: {
              kind: 'youtube#videoListResponse',
              items: [fullVideo('aaa', 'PT5M'), fullVideo('bbb', 'PT30S')],
            },
          })
    )

    const result = await listDocuments(API_KEY, {
      playlistId: PLAYLIST_ID,
      excludeShorts: 'true',
    })

    expect(result.documents.map((d) => d.externalId)).toEqual(['aaa'])
    expect(result.documents[0].contentDeferred).toBe(false)
    expect(urls[1]).toContain('/videos?part=snippet%2CcontentDetails%2Cstatus')
  })

  it('advances pagination when every video on a page is an excluded Short', async () => {
    mockFetch((url) =>
      url.includes('/playlistItems')
        ? fakeResponse({ body: playlistPage([item('aaa'), item('bbb')], 'TOKEN2') })
        : fakeResponse({
            body: {
              kind: 'youtube#videoListResponse',
              items: [fullVideo('aaa', 'PT20S'), fullVideo('bbb', 'PT10S')],
            },
          })
    )

    const result = await listDocuments(API_KEY, {
      playlistId: PLAYLIST_ID,
      excludeShorts: 'true',
    })

    expect(result.documents).toEqual([])
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe('TOKEN2')
  })

  it('blocks reconciliation instead of dropping a page when the shorts lookup is untrusted', async () => {
    mockFetch((url) =>
      url.includes('/playlistItems')
        ? fakeResponse({ body: playlistPage([item('aaa'), item('bbb')], 'TOKEN2') })
        : fakeResponse({ body: videoListBody([]) })
    )

    const syncContext: Record<string, unknown> = {}
    const result = await listDocuments(
      API_KEY,
      { playlistId: PLAYLIST_ID, excludeShorts: 'true' },
      undefined,
      syncContext
    )

    expect(result.documents).toEqual([])
    expect(syncContext.listingCapped).toBe(true)
    expect(syncContext.listingTruncated).toBe(true)
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe('TOKEN2')
  })
})

describe('youtubeConnector.getDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('hydrates a video into a full document', async () => {
    const urls = mockFetch(() =>
      fakeResponse({
        body: { kind: 'youtube#videoListResponse', items: [fullVideo('aaa', 'PT5M')] },
      })
    )

    const doc = await getDocument(API_KEY, {}, 'aaa')

    expect(doc?.externalId).toBe('aaa')
    expect(doc?.content).toBe('Video aaa\n\ndesc')
    expect(urls[0]).toContain('id=aaa')
  })

  it('returns null when the video is gone (empty items)', async () => {
    mockFetch(() => fakeResponse({ body: { kind: 'youtube#videoListResponse', items: [] } }))

    expect(await getDocument(API_KEY, {}, 'aaa')).toBe(null)
  })

  it('returns null on 403 and 404 without throwing', async () => {
    mockFetch(() => fakeResponse({ status: 403, text: 'forbidden' }))
    expect(await getDocument(API_KEY, {}, 'aaa')).toBe(null)

    vi.unstubAllGlobals()
    mockFetch(() => fakeResponse({ status: 404, text: 'notFound' }))
    expect(await getDocument(API_KEY, {}, 'aaa')).toBe(null)
  })

  it('swallows transport failures and returns null', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('boom')
      })
    )

    expect(await getDocument(API_KEY, {}, 'aaa')).toBe(null)
  })
})
