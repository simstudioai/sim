/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { youtubeConnector } from '@/connectors/youtube/youtube'

const API_KEY = 'test-key'
const PLAYLIST_ID = 'PL123'

interface TestPlaylistItem {
  contentDetails?: { videoId?: string; videoPublishedAt?: string }
  snippet?: { title?: string; resourceId?: { videoId?: string } }
  status?: { privacyStatus?: string }
}

/** Builds a playlist item, optionally carrying an explicit `status.privacyStatus`. */
function item(videoId: string, privacyStatus?: string, title = 'A video'): TestPlaylistItem {
  return {
    contentDetails: { videoId, videoPublishedAt: '2024-01-01T00:00:00Z' },
    snippet: { title },
    ...(privacyStatus === undefined ? {} : { status: { privacyStatus } }),
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

/** Registers a fetch mock that answers by URL, recording every requested URL. */
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

function playlistPage(items: TestPlaylistItem[], nextPageToken?: string) {
  return { items, ...(nextPageToken ? { nextPageToken } : {}) }
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

/** Answers the playlist page and fails loudly on any unexpected second call. */
function playlistOnly(items: TestPlaylistItem[], nextPageToken?: string) {
  return (url: string): Response => {
    if (url.includes('/playlistItems')) {
      return fakeResponse({ body: playlistPage(items, nextPageToken) })
    }
    throw new Error(`unexpected request: ${url}`)
  }
}

const listDocuments = youtubeConnector.listDocuments
const getDocument = youtubeConnector.getDocument

describe('youtubeConnector.listDocuments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('requests the status part and makes no extra videos.list call', async () => {
    const urls = mockFetch(playlistOnly([item('aaa', 'public'), item('bbb', 'unlisted')]))

    const result = await listDocuments(API_KEY, { playlistId: PLAYLIST_ID })

    expect(result.documents.map((d) => d.externalId)).toEqual(['aaa', 'bbb'])
    expect(urls).toHaveLength(1)
    expect(urls[0]).toContain('part=snippet%2CcontentDetails%2Cstatus')
    expect(urls[0]).toContain('/playlistItems')
  })

  it('excludes only items whose privacyStatus is explicitly private', async () => {
    mockFetch(
      playlistOnly([
        item('aaa', 'public'),
        item('bbb', 'private', 'Deleted video'),
        item('ccc', 'unlisted'),
      ])
    )

    const result = await listDocuments(API_KEY, { playlistId: PLAYLIST_ID })

    expect(result.documents.map((d) => d.externalId)).toEqual(['aaa', 'ccc'])
  })

  it('keeps an item when the status part is missing entirely', async () => {
    mockFetch(playlistOnly([item('aaa'), item('bbb')]))

    const result = await listDocuments(API_KEY, { playlistId: PLAYLIST_ID })

    expect(result.documents.map((d) => d.externalId)).toEqual(['aaa', 'bbb'])
  })

  it('keeps an item when privacyStatus is empty or unrecognized', async () => {
    mockFetch(
      playlistOnly([
        item('aaa', ''),
        item('bbb', 'privacyStatusUnspecified'),
        item('ccc', 'PRIVATE'),
      ])
    )

    const result = await listDocuments(API_KEY, { playlistId: PLAYLIST_ID })

    expect(result.documents.map((d) => d.externalId)).toEqual(['aaa', 'bbb', 'ccc'])
  })

  it('keeps an item whose title looks like a placeholder but whose status is public', async () => {
    mockFetch(playlistOnly([item('aaa', 'public', 'Deleted video')]))

    const result = await listDocuments(API_KEY, { playlistId: PLAYLIST_ID })

    expect(result.documents.map((d) => d.externalId)).toEqual(['aaa'])
  })

  it('falls back to snippet.resourceId.videoId and drops items with no video id', async () => {
    mockFetch(
      playlistOnly([
        { snippet: { resourceId: { videoId: 'ccc' } } },
        { snippet: { title: 'No id' } },
      ])
    )

    const result = await listDocuments(API_KEY, { playlistId: PLAYLIST_ID })

    expect(result.documents.map((d) => d.externalId)).toEqual(['ccc'])
  })

  it('advances pagination on the real cursor even when every item on a page is private', async () => {
    mockFetch(playlistOnly([item('aaa', 'private'), item('bbb', 'private')], 'TOKEN2'))

    const syncContext: Record<string, unknown> = {}
    const result = await listDocuments(API_KEY, { playlistId: PLAYLIST_ID }, undefined, syncContext)

    expect(result.documents).toEqual([])
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe('TOKEN2')
    expect(syncContext.listingCapped).toBeUndefined()
    expect(syncContext.listingTruncated).toBeUndefined()
  })

  it('throws when the playlistItems listing itself fails', async () => {
    mockFetch(() => fakeResponse({ status: 404, text: 'playlistNotFound' }))

    await expect(listDocuments(API_KEY, { playlistId: PLAYLIST_ID })).rejects.toThrow(
      'Failed to list YouTube playlist items: 404'
    )
  })

  it('emits nothing and makes no videos.list call for an empty page', async () => {
    const urls = mockFetch(playlistOnly([]))

    const result = await listDocuments(API_KEY, { playlistId: PLAYLIST_ID })

    expect(result.documents).toEqual([])
    expect(urls).toHaveLength(1)
  })

  it('hydrates full documents and drops Shorts when excludeShorts is on', async () => {
    const urls = mockFetch((url) =>
      url.includes('/playlistItems')
        ? fakeResponse({
            body: playlistPage([
              item('aaa', 'public'),
              item('bbb', 'public'),
              item('ccc', 'public'),
            ]),
          })
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

    // 'bbb' is a real Short and is intentionally out of scope, so it leaves the listing
    // and reconciles normally. 'ccc' is merely absent from videos.list — absence is not
    // deletion, so it stays in the listing as a deferred stub for getDocument to judge.
    expect(result.documents.map((d) => d.externalId)).toEqual(['aaa', 'ccc'])
    expect(result.documents[0].contentDeferred).toBe(false)
    expect(result.documents[1]).toMatchObject({
      contentDeferred: true,
      content: '',
      contentHash: 'youtube:ccc:2024-01-01T00:00:00Z',
    })
    expect(urls[1]).toContain('/videos?part=snippet%2CcontentDetails%2Cstatus')
  })

  it('drops private items before the excludeShorts videos.list call is even made', async () => {
    const urls = mockFetch((url) =>
      url.includes('/playlistItems')
        ? fakeResponse({ body: playlistPage([item('aaa', 'public'), item('bbb', 'private')]) })
        : fakeResponse({
            body: { kind: 'youtube#videoListResponse', items: [fullVideo('aaa', 'PT5M')] },
          })
    )

    const result = await listDocuments(API_KEY, {
      playlistId: PLAYLIST_ID,
      excludeShorts: 'true',
    })

    expect(result.documents.map((d) => d.externalId)).toEqual(['aaa'])
    expect(urls[1]).toContain('id=aaa&')
    expect(urls[1]).not.toContain('bbb')
  })

  it('blocks reconciliation instead of dropping a page when the shorts lookup is untrusted', async () => {
    mockFetch((url) =>
      url.includes('/playlistItems')
        ? fakeResponse({
            body: playlistPage([item('aaa', 'public'), item('bbb', 'public')], 'TOKEN2'),
          })
        : fakeResponse({ body: { kind: 'youtube#videoListResponse', items: [] } })
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

  it('throws (aborting the sync, which deletes nothing) when the shorts videos.list 403s', async () => {
    mockFetch((url) =>
      url.includes('/playlistItems')
        ? fakeResponse({ body: playlistPage([item('aaa', 'public')]) })
        : fakeResponse({ status: 403, text: 'quotaExceeded' })
    )

    await expect(
      listDocuments(API_KEY, { playlistId: PLAYLIST_ID, excludeShorts: 'true' })
    ).rejects.toThrow('Failed to batch-fetch YouTube videos: 403')
  })

  it('caps the listing when maxVideos trims videos off the last page', async () => {
    mockFetch(playlistOnly([item('aaa'), item('bbb'), item('ccc')]))

    const syncContext: Record<string, unknown> = {}
    const result = await listDocuments(
      API_KEY,
      { playlistId: PLAYLIST_ID, maxVideos: '2' },
      undefined,
      syncContext
    )

    // 'ccc' exists at the source but was trimmed by the cap, so reconciling deletions
    // against this listing would hard-delete it.
    expect(result.documents.map((d) => d.externalId)).toEqual(['aaa', 'bbb'])
    expect(syncContext.listingCapped).toBe(true)
    expect(result.hasMore).toBe(false)
  })

  it('does not cap when maxVideos coincides exactly with an exhausted source', async () => {
    mockFetch(playlistOnly([item('aaa'), item('bbb')]))

    const syncContext: Record<string, unknown> = {}
    const result = await listDocuments(
      API_KEY,
      { playlistId: PLAYLIST_ID, maxVideos: '2' },
      undefined,
      syncContext
    )

    expect(result.documents.map((d) => d.externalId)).toEqual(['aaa', 'bbb'])
    expect(syncContext.listingCapped).toBeUndefined()
  })

  it('keeps paginating past an out-of-cutoff item instead of breaking early', async () => {
    const dated = (videoId: string, videoPublishedAt: string): TestPlaylistItem => ({
      contentDetails: { videoId, videoPublishedAt },
      snippet: { title: 'A video' },
    })

    mockFetch(
      playlistOnly(
        [dated('old', '2020-01-01T00:00:00Z'), dated('new', '2024-06-01T00:00:00Z')],
        'TOKEN2'
      )
    )

    const result = await listDocuments(API_KEY, {
      channelId: 'UC_x5XG1OV2P6uZZ5FSM9Ttw',
      playlistId: PLAYLIST_ID,
      publishedAfter: '2024-01-01',
    })

    // Playlist ordering is undocumented, so an old item must not stop the scan — the
    // newer item after it still has to reach the listing.
    expect(result.documents.map((d) => d.externalId)).toEqual(['new'])
    expect(result.hasMore).toBe(true)
    expect(result.nextCursor).toBe('TOKEN2')
  })

  it('resolves a bare channel reference as a handle before falling back to forUsername', async () => {
    const urls = mockFetch((url) => {
      if (url.includes('/channels')) {
        return fakeResponse({
          body: url.includes('forHandle')
            ? { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU123' } } }] }
            : { items: [] },
        })
      }
      return fakeResponse({ body: playlistPage([item('aaa', 'public')]) })
    })

    const result = await listDocuments(API_KEY, { channelId: 'mkbhd' })

    expect(urls[0]).toContain('forHandle=mkbhd')
    expect(urls.some((u) => u.includes('forUsername'))).toBe(false)
    expect(urls[1]).toContain('playlistId=UU123')
    expect(result.documents.map((d) => d.externalId)).toEqual(['aaa'])
  })

  it('falls back to forUsername when a bare reference is not a handle', async () => {
    const urls = mockFetch((url) => {
      if (url.includes('/channels')) {
        return fakeResponse({
          body: url.includes('forUsername')
            ? { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UU999' } } }] }
            : { items: [] },
        })
      }
      return fakeResponse({ body: playlistPage([item('aaa', 'public')]) })
    })

    await listDocuments(API_KEY, { channelId: 'LegacyUser' })

    expect(urls[0]).toContain('forHandle=LegacyUser')
    expect(urls[1]).toContain('forUsername=LegacyUser')
    expect(urls[2]).toContain('playlistId=UU999')
  })

  it('resolves a UC channel id with the id filter and never tries a handle', async () => {
    const channelId = `UC${'a'.repeat(22)}`
    const urls = mockFetch((url) =>
      url.includes('/channels')
        ? fakeResponse({
            body: { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUabc' } } }] },
          })
        : fakeResponse({ body: playlistPage([item('aaa', 'public')]) })
    )

    await listDocuments(API_KEY, { channelId })

    expect(urls[0]).toContain(`id=${channelId}`)
    expect(urls.some((u) => u.includes('forHandle') || u.includes('forUsername'))).toBe(false)
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

  it('returns null on 404 without throwing', async () => {
    mockFetch(() => fakeResponse({ status: 404, text: 'notFound' }))
    expect(await getDocument(API_KEY, {}, 'aaa')).toBe(null)
  })

  it('throws on 403 so quota exhaustion is not mistaken for a deleted video', async () => {
    mockFetch(() => fakeResponse({ status: 403, text: 'quotaExceeded' }))
    await expect(getDocument(API_KEY, {}, 'aaa')).rejects.toThrow('403')
  })

  it('rethrows transport failures so the sync engine records them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('boom')
      })
    )

    await expect(getDocument(API_KEY, {}, 'aaa')).rejects.toThrow('boom')
  })
})
