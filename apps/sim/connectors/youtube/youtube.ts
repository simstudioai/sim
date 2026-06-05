import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { YouTubeIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { joinTagArray, parseTagDate } from '@/connectors/utils'

const logger = createLogger('YouTubeConnector')

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3'

/** Max videos fetched per `playlistItems.list` page (YouTube hard limit is 50). */
const PAGE_SIZE = 50

/** Videos shorter than this (seconds) are treated as Shorts when the exclude filter is on. */
const SHORTS_MAX_DURATION_SECONDS = 60

/**
 * Minimal `playlistItems.list` item shape we consume.
 * `contentDetails.videoId` is the stable video identifier; `snippet.resourceId.videoId`
 * is used as a fallback for older API responses.
 *
 * `snippet.publishedAt` is the time the item was ADDED to the playlist, whereas
 * `contentDetails.videoPublishedAt` is the time the VIDEO was published to YouTube.
 * These differ for hand-curated playlists, so only `videoPublishedAt` is used for the
 * change-detection hash (it matches `videos.list` `snippet.publishedAt`).
 */
interface PlaylistItem {
  contentDetails?: { videoId?: string; videoPublishedAt?: string }
  snippet?: {
    title?: string
    publishedAt?: string
    channelTitle?: string
    videoOwnerChannelTitle?: string
    resourceId?: { videoId?: string }
  }
}

/**
 * Minimal `videos.list` item shape we consume in `getDocument`.
 */
interface VideoItem {
  id?: string
  snippet?: {
    title?: string
    description?: string
    publishedAt?: string
    channelTitle?: string
    tags?: string[]
    categoryId?: string
  }
  contentDetails?: { duration?: string }
  status?: { privacyStatus?: string }
}

/**
 * Resolves the API key from the access token the sync engine provides.
 * In `apiKey` mode the engine decrypts the stored key and passes it as `accessToken`.
 */
function getApiKey(accessToken: string): string {
  return accessToken.trim()
}

/**
 * Builds the change-detection hash for a video.
 *
 * The hash is keyed on the video's own publish time (`videos.list` `snippet.publishedAt`
 * / playlistItem `contentDetails.videoPublishedAt`), which is identical on both the
 * listing stub and the hydrated document — guaranteeing the stub/getDocument hash
 * invariant. The playlist-item "added at" time (`snippet.publishedAt`) is deliberately
 * NOT used, since `getDocument` (via `videos.list`) cannot reproduce it.
 *
 * YouTube exposes no field that reliably changes when a video's title/description is
 * edited, so edits to already-synced videos are not detected — only new videos are
 * picked up. This is a known limitation of the API-key data surface.
 */
function buildContentHash(videoId: string, videoPublishedAt: string): string {
  return `youtube:${videoId}:${videoPublishedAt}`
}

/**
 * Parses an ISO 8601 duration (e.g. `PT1M30S`, `PT2H`, `P1DT2H`) into total seconds.
 * Returns null when the value is missing or unparseable.
 */
function parseIso8601Duration(value: string | undefined): number | null {
  if (!value) return null
  const match = value.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/)
  if (!match) return null
  const [, days, hours, minutes, seconds] = match
  if (!days && !hours && !minutes && !seconds) return null
  return (
    Number(days ?? 0) * 86400 +
    Number(hours ?? 0) * 3600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0)
  )
}

/**
 * Resolves a channel reference to its "uploads" playlist ID via `channels.list`.
 *
 * Accepts a `UC…` channel ID, an `@handle` (resolved with `forHandle`), or a legacy
 * username (resolved with `forUsername`). Returns null when the channel is missing or
 * has no uploads playlist.
 */
async function resolveUploadsPlaylistId(
  apiKey: string,
  channelRef: string,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<string | null> {
  const ref = channelRef.trim()
  if (!ref) return null

  const params = new URLSearchParams({ part: 'contentDetails', key: apiKey })
  if (ref.startsWith('@')) {
    params.set('forHandle', ref)
  } else if (/^UC[\w-]{20,}$/.test(ref)) {
    params.set('id', ref)
  } else {
    params.set('forUsername', ref)
  }

  const url = `${YOUTUBE_API_BASE}/channels?${params.toString()}`

  const response = await fetchWithRetry(
    url,
    { method: 'GET', headers: { Accept: 'application/json' } },
    retryOptions
  )

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    logger.error('Failed to resolve channel uploads playlist', {
      channelRef: ref,
      status: response.status,
      error: errorText.slice(0, 500),
    })
    throw new Error(`Failed to resolve channel: ${response.status}`)
  }

  const data = await response.json()
  const items = (data.items ?? []) as Array<{
    contentDetails?: { relatedPlaylists?: { uploads?: string } }
  }>
  return items[0]?.contentDetails?.relatedPlaylists?.uploads ?? null
}

/**
 * Resolves the effective playlist ID to sync from sourceConfig, and whether the source
 * is a channel's reverse-chronological uploads playlist (which enables early-stop for
 * the `publishedAfter` filter). A `playlistId` takes precedence over a `channelId`.
 */
async function resolvePlaylistId(
  apiKey: string,
  sourceConfig: Record<string, unknown>,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<{ playlistId: string | null; isUploadsPlaylist: boolean }> {
  const playlistId = (sourceConfig.playlistId as string | undefined)?.trim()
  if (playlistId) return { playlistId, isUploadsPlaylist: false }

  const channelId = (sourceConfig.channelId as string | undefined)?.trim()
  if (channelId) {
    const resolved = await resolveUploadsPlaylistId(apiKey, channelId, retryOptions)
    return { playlistId: resolved, isUploadsPlaylist: resolved != null }
  }

  return { playlistId: null, isUploadsPlaylist: false }
}

/**
 * Extracts the video ID from a playlist item, preferring the stable
 * `contentDetails.videoId` over the legacy `snippet.resourceId.videoId`.
 */
function getVideoId(item: PlaylistItem): string {
  return item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId ?? ''
}

/**
 * Reads the optional `publishedAfter` cutoff from sourceConfig as a timestamp (ms),
 * or null when unset/invalid.
 */
function getPublishedAfter(sourceConfig: Record<string, unknown>): number | null {
  const raw = (sourceConfig.publishedAfter as string | undefined)?.trim()
  if (!raw) return null
  const ms = new Date(raw).getTime()
  return Number.isNaN(ms) ? null : ms
}

/**
 * Builds a metadata-only stub from a playlist item.
 *
 * Duration/tags/category are not available on `playlistItems.list` — they are populated
 * during hydration in `getDocument` via `videos.list`. The content hash uses the video's
 * publish time only, so it is identical between this stub and the hydrated document.
 */
function itemToStub(item: PlaylistItem): ExternalDocument | null {
  const videoId = getVideoId(item)
  if (!videoId) return null

  const snippet = item.snippet ?? {}
  const videoPublishedAt = item.contentDetails?.videoPublishedAt ?? ''
  const channelTitle = snippet.videoOwnerChannelTitle ?? snippet.channelTitle ?? ''

  return {
    externalId: videoId,
    title: snippet.title || 'Untitled',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    contentHash: buildContentHash(videoId, videoPublishedAt),
    metadata: {
      channelTitle,
      publishedAt: videoPublishedAt,
    },
  }
}

/**
 * Batch-fetches full video resources for the given IDs via `videos.list`.
 *
 * `videos.list` accepts up to 50 comma-separated IDs and costs a flat 1 quota unit per
 * call regardless of ID count, so a single call covers a full `playlistItems.list` page.
 * Videos that are private, deleted, or region-blocked are simply absent from the response.
 */
async function fetchVideosByIds(
  apiKey: string,
  videoIds: string[],
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<Map<string, VideoItem>> {
  const result = new Map<string, VideoItem>()
  if (videoIds.length === 0) return result

  const url = `${YOUTUBE_API_BASE}/videos?part=snippet,contentDetails,status&id=${encodeURIComponent(
    videoIds.join(',')
  )}&key=${encodeURIComponent(apiKey)}`

  const response = await fetchWithRetry(
    url,
    { method: 'GET', headers: { Accept: 'application/json' } },
    retryOptions
  )

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    logger.error('Failed to batch-fetch YouTube videos', {
      count: videoIds.length,
      status: response.status,
      error: errorText.slice(0, 500),
    })
    throw new Error(`Failed to batch-fetch YouTube videos: ${response.status}`)
  }

  const data = await response.json()
  const items = (data.items ?? []) as VideoItem[]
  for (const item of items) {
    if (item.id) result.set(item.id, item)
  }
  return result
}

/**
 * Builds the full document for a video, combining title and description as plain-text
 * content. Returns null for unlisted/private/deleted videos, and (when configured) for
 * Shorts shorter than 60 seconds.
 *
 * Captions/transcripts are intentionally not fetched: `captions.download` requires OAuth
 * as the video owner, which the API-key auth surface cannot provide. Content is therefore
 * the video title plus description only.
 */
function videoToDocument(video: VideoItem, excludeShorts: boolean): ExternalDocument | null {
  const videoId = video.id
  if (!videoId) return null

  const privacyStatus = video.status?.privacyStatus
  if (privacyStatus && privacyStatus !== 'public' && privacyStatus !== 'unlisted') {
    return null
  }

  if (excludeShorts) {
    const seconds = parseIso8601Duration(video.contentDetails?.duration)
    if (seconds != null && seconds > 0 && seconds < SHORTS_MAX_DURATION_SECONDS) {
      return null
    }
  }

  const snippet = video.snippet ?? {}
  const title = snippet.title || 'Untitled'
  const description = snippet.description ?? ''
  const publishedAt = snippet.publishedAt ?? ''
  const content = description.trim() ? `${title}\n\n${description}` : title
  const tags = Array.isArray(snippet.tags) ? snippet.tags : []

  return {
    externalId: videoId,
    title,
    content,
    contentDeferred: false,
    mimeType: 'text/plain',
    sourceUrl: `https://www.youtube.com/watch?v=${videoId}`,
    contentHash: buildContentHash(videoId, publishedAt),
    metadata: {
      channelTitle: snippet.channelTitle ?? '',
      publishedAt,
      duration: video.contentDetails?.duration ?? '',
      categoryId: snippet.categoryId ?? '',
      tags,
    },
  }
}

export const youtubeConnector: ConnectorConfig = {
  id: 'youtube',
  name: 'YouTube',
  description: 'Sync videos from a YouTube channel or playlist into your knowledge base',
  version: '1.0.0',
  icon: YouTubeIcon,

  auth: {
    mode: 'apiKey',
    label: 'YouTube Data API Key',
    placeholder: 'Enter your YouTube Data API v3 key',
  },

  configFields: [
    {
      id: 'channelId',
      title: 'Channel',
      type: 'short-input',
      placeholder: 'e.g. @mkbhd or UCXXXXXXXXXXXXXXXXXXXXXX',
      required: false,
      description:
        'Channel handle (@name), channel ID (starts with "UC"), or legacy username. Syncs the channel\'s uploaded videos.',
    },
    {
      id: 'playlistId',
      title: 'Playlist ID',
      type: 'short-input',
      placeholder: 'e.g. PLXXXXXXXXXXXXXXXX',
      required: false,
      description: 'Playlist ID. Takes precedence over Channel when both are set.',
    },
    {
      id: 'publishedAfter',
      title: 'Published After',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 2024-01-01',
      description:
        'Only sync videos published on or after this date (ISO 8601, e.g. 2024-01-01). Applies to the video publish date.',
    },
    {
      id: 'excludeShorts',
      title: 'Exclude Shorts',
      type: 'dropdown',
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Include Shorts', id: 'false' },
        { label: 'Exclude Shorts (< 60s)', id: 'true' },
      ],
      description: 'Skip videos shorter than 60 seconds (Shorts).',
    },
    {
      id: 'maxVideos',
      title: 'Max Videos',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const apiKey = getApiKey(accessToken)

    const maxVideos = sourceConfig.maxVideos ? Number(sourceConfig.maxVideos) : 0
    const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0

    if (maxVideos > 0 && previouslyFetched >= maxVideos) {
      return { documents: [], hasMore: false }
    }

    const cachedPlaylistId = syncContext?.resolvedPlaylistId as string | undefined
    let playlistId: string | null = cachedPlaylistId ?? null
    let isUploadsPlaylist = (syncContext?.isUploadsPlaylist as boolean | undefined) ?? false

    if (!playlistId) {
      const resolved = await resolvePlaylistId(apiKey, sourceConfig)
      playlistId = resolved.playlistId
      isUploadsPlaylist = resolved.isUploadsPlaylist
      if (syncContext) {
        if (playlistId) syncContext.resolvedPlaylistId = playlistId
        syncContext.isUploadsPlaylist = isUploadsPlaylist
      }
    }

    if (!playlistId) {
      throw new Error('No playlistId or channelId configured, or channel has no uploads playlist')
    }

    const publishedAfter = getPublishedAfter(sourceConfig)

    const remaining = maxVideos > 0 ? maxVideos - previouslyFetched : 0
    const effectivePageSize = maxVideos > 0 ? Math.min(PAGE_SIZE, remaining) : PAGE_SIZE

    const queryParams = new URLSearchParams({
      part: 'snippet,contentDetails',
      playlistId,
      maxResults: String(effectivePageSize),
      key: apiKey,
    })
    if (cursor) queryParams.set('pageToken', cursor)

    const url = `${YOUTUBE_API_BASE}/playlistItems?${queryParams.toString()}`

    logger.info('Listing YouTube playlist items', { playlistId, cursor: cursor ?? 'initial' })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error('Failed to list YouTube playlist items', {
        playlistId,
        status: response.status,
        error: errorText.slice(0, 500),
      })
      throw new Error(`Failed to list YouTube playlist items: ${response.status}`)
    }

    const data = await response.json()
    const items = (data.items ?? []) as PlaylistItem[]
    const excludeShorts = String(sourceConfig.excludeShorts ?? '') === 'true'

    const keptItems: PlaylistItem[] = []
    let stopEarly = false

    for (const item of items) {
      if (!getVideoId(item)) continue

      if (publishedAfter != null) {
        const videoPublishedAt = item.contentDetails?.videoPublishedAt
        const ms = videoPublishedAt ? new Date(videoPublishedAt).getTime() : Number.NaN
        if (!Number.isNaN(ms) && ms < publishedAfter) {
          // Uploads playlists are reverse-chronological by publish date, so once we
          // cross the cutoff no later item can qualify — stop paginating. For arbitrary
          // playlists we only filter per-item (order is not guaranteed).
          if (isUploadsPlaylist) {
            stopEarly = true
            break
          }
          continue
        }
      }

      keptItems.push(item)
    }

    let documents: ExternalDocument[] = []

    if (excludeShorts && keptItems.length > 0) {
      // When excluding Shorts we must know each video's duration, which is not exposed on
      // `playlistItems.list`. Resolve it here with a single batched `videos.list` call
      // (1 quota unit per page) and emit FULLY-HYDRATED documents. This is deliberate:
      // emitting deferred stubs for Shorts would make every excluded Short re-list as a
      // brand-new doc on every sync (it is never persisted), re-hydrating to null forever.
      // Filtering at listing time bounds the cost to one batched call per page per sync.
      const videoMap = await fetchVideosByIds(apiKey, keptItems.map(getVideoId))
      for (const item of keptItems) {
        const video = videoMap.get(getVideoId(item))
        // Absent from `videos.list` => private/deleted/region-blocked. Drop it instead of
        // emitting a stub that would re-hydrate to null on every sync.
        if (!video) continue
        const doc = videoToDocument(video, true)
        if (doc) documents.push(doc)
      }
    } else {
      for (const item of keptItems) {
        const stub = itemToStub(item)
        if (stub) documents.push(stub)
      }
    }

    const totalFetched = previouslyFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched

    const hitMax = maxVideos > 0 && totalFetched >= maxVideos
    if (hitMax && maxVideos > 0) {
      const overflow = totalFetched - maxVideos
      if (overflow > 0) documents = documents.slice(0, documents.length - overflow)
      if (syncContext) syncContext.totalDocsFetched = maxVideos
    }

    const nextPageToken = data.nextPageToken as string | undefined

    // When the `maxVideos` cap stops the listing before the source is exhausted, mark the
    // listing as capped so the sync engine does not delete still-present-but-unlisted
    // videos from the knowledge base. `stopEarly` (publishedAfter cutoff) is NOT a cap —
    // every remaining video is older than the cutoff and intentionally out of scope, so
    // those should reconcile (delete) normally.
    if (hitMax && Boolean(nextPageToken) && syncContext) {
      syncContext.listingCapped = true
    }

    const hasMore = !hitMax && !stopEarly && Boolean(nextPageToken)

    return {
      documents,
      nextCursor: hasMore ? nextPageToken : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const apiKey = getApiKey(accessToken)
    const excludeShorts = String(sourceConfig.excludeShorts ?? '') === 'true'

    const url = `${YOUTUBE_API_BASE}/videos?part=snippet,contentDetails,status&id=${encodeURIComponent(externalId)}&key=${encodeURIComponent(apiKey)}`

    try {
      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })

      if (!response.ok) {
        if (response.status === 403 || response.status === 404) return null
        throw new Error(`Failed to get YouTube video: ${response.status}`)
      }

      const data = await response.json()
      const items = (data.items ?? []) as VideoItem[]
      const video = items[0]

      // An empty items array means the video is deleted, private, or region-blocked.
      if (!video) return null

      return videoToDocument(video, excludeShorts)
    } catch (error) {
      logger.warn(`Failed to fetch YouTube video ${externalId}`, { error: toError(error).message })
      return null
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const apiKey = getApiKey(accessToken)
    if (!apiKey) {
      return { valid: false, error: 'A YouTube Data API key is required' }
    }

    const channelId = (sourceConfig.channelId as string | undefined)?.trim()
    const playlistId = (sourceConfig.playlistId as string | undefined)?.trim()
    if (!channelId && !playlistId) {
      return { valid: false, error: 'Provide a channel or a playlistId' }
    }

    const maxVideos = sourceConfig.maxVideos as string | undefined
    if (maxVideos && (Number.isNaN(Number(maxVideos)) || Number(maxVideos) <= 0)) {
      return { valid: false, error: 'Max videos must be a positive number' }
    }

    const publishedAfterRaw = (sourceConfig.publishedAfter as string | undefined)?.trim()
    if (publishedAfterRaw && Number.isNaN(new Date(publishedAfterRaw).getTime())) {
      return { valid: false, error: 'Published After must be a valid date (e.g. 2024-01-01)' }
    }

    try {
      const resolvedPlaylistId = playlistId
        ? playlistId
        : await resolveUploadsPlaylistId(apiKey, channelId as string, VALIDATE_RETRY_OPTIONS)

      if (!resolvedPlaylistId) {
        return { valid: false, error: 'Channel not found or has no uploaded videos' }
      }

      const url = `${YOUTUBE_API_BASE}/playlistItems?part=id&maxResults=1&playlistId=${encodeURIComponent(resolvedPlaylistId)}&key=${encodeURIComponent(apiKey)}`
      const response = await fetchWithRetry(
        url,
        { method: 'GET', headers: { Accept: 'application/json' } },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        if (response.status === 403) {
          return {
            valid: false,
            error:
              'API key rejected. Check that the key is valid, has no HTTP referrer/IP restrictions (server-side use requires an unrestricted or IP-allowed key), and that your daily quota is not exhausted.',
          }
        }
        if (response.status === 404) {
          return { valid: false, error: 'Playlist not found. Check the playlist or channel ID.' }
        }
        return { valid: false, error: `Failed to access YouTube: ${response.status}` }
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: getErrorMessage(error, 'Failed to validate configuration') }
    }
  },

  tagDefinitions: [
    { id: 'channelTitle', displayName: 'Channel', fieldType: 'text' },
    { id: 'publishedAt', displayName: 'Published Date', fieldType: 'date' },
    { id: 'duration', displayName: 'Duration', fieldType: 'text' },
    { id: 'tags', displayName: 'Tags', fieldType: 'text' },
  ],

  /**
   * Maps document metadata to tag slots. `duration` and `tags` are only present after
   * hydration in `getDocument`; on the listing stub they are absent and simply skipped
   * by the guards below. The sync engine only runs `mapTags` on add/update (after
   * hydration), so durations/tags are populated when tags are actually written.
   */
  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.channelTitle === 'string' && metadata.channelTitle.trim()) {
      result.channelTitle = metadata.channelTitle
    }

    const publishedAt = parseTagDate(metadata.publishedAt)
    if (publishedAt) result.publishedAt = publishedAt

    if (typeof metadata.duration === 'string' && metadata.duration.trim()) {
      result.duration = metadata.duration
    }

    const tags = joinTagArray(metadata.tags)
    if (tags) result.tags = tags

    return result
  },
}
