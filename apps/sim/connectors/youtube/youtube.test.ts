import { describe, expect, it, vi } from 'vitest'
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

function _fullVideo(id: string, duration: string) {
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
})

describe('youtubeConnector.getDocument', () => {
  it('throws on 403 so quota exhaustion is not mistaken for a deleted video', async () => {
    mockFetch(() => fakeResponse({ status: 403, text: 'quotaExceeded' }))
    await expect(getDocument(API_KEY, {}, 'aaa')).rejects.toThrow('403')
  })
})
