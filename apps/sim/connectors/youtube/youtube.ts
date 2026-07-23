import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { joinTagArray, parseTagDate } from '@/connectors/utils'
import { youtubeConnectorMeta } from '@/connectors/youtube/meta'

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
export interface PlaylistItem {
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
 * `videos.list` part sets used by this connector. The full set hydrates a document; the
 * id-only set is the cheapest way to ask "do these videos still exist?".
 */
const VIDEO_PART_FULL = 'snippet,contentDetails,status'
const VIDEO_PART_ID_ONLY = 'id'

/** Documented `kind` of a `videos.list` response body. */
const VIDEO_LIST_KIND = 'youtube#videoListResponse'

/**
 * Untyped `videos.list` response envelope. The payload is validated by
 * `readTrustedVideoItems` before any field is consumed.
 */
interface VideoListResponse {
  kind?: unknown
  items?: unknown
}

/**
 * Issues a single `videos.list` call for the given IDs and part set.
 *
 * `videos.list` accepts up to 50 comma-separated IDs and costs a flat 1 quota unit per
 * call regardless of ID count or part set, so one call covers a full
 * `playlistItems.list` page. `maxResults` is explicitly unsupported alongside `id`, so an
 * ID-filtered response is never paginated.
 *
 * A non-OK response throws. That deliberately aborts the whole sync: `runConnectorSync`
 * pushes listing pages inside its try block and reaches deletion reconciliation only
 * after the pagination loop completes, so an aborted listing performs no reconciliation
 * and deletes nothing (the failure path only records the error and backs the connector
 * off). Failing loud is therefore strictly safer than returning a partial listing.
 */
async function fetchVideoList(
  apiKey: string,
  videoIds: string[],
  part: string,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<VideoListResponse> {
  const url = `${YOUTUBE_API_BASE}/videos?part=${encodeURIComponent(part)}&id=${encodeURIComponent(
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
      part,
      status: response.status,
      error: errorText.slice(0, 500),
    })
    throw new Error(`Failed to batch-fetch YouTube videos: ${response.status}`)
  }

  return (await response.json()) as VideoListResponse
}

/**
 * Narrows a `videos.list` payload to its item array, or returns null when the response
 * cannot be trusted as a complete answer to the request that was made.
 *
 * The YouTube reference documents neither that every requested existing ID is returned
 * nor how a partially-degraded batch is signalled, so absence from the response is only
 * ever read as "this video is gone" when the payload is unambiguous. A response is
 * rejected as untrusted when:
 * - `kind` is present and is not `youtube#videoListResponse` (not a video listing)
 * - `items` is missing or is not an array (malformed envelope)
 * - `items` is empty while IDs were requested — indistinguishable from a degraded 200,
 *   and reading it literally would drop an entire page at once
 * - any entry is not an object, lacks a non-empty string `id`, or carries an `id` that
 *   was never requested (the body does not correspond to this request)
 *
 * Callers fail open on null. The residual exposure is a well-formed response that omits
 * only *some* still-live IDs; that cannot be detected from the payload, and treating a
 * partial response as untrusted is impossible without a completeness guarantee the API
 * does not provide.
 */
export function readTrustedVideoItems(
  data: VideoListResponse,
  requestedIds: readonly string[]
): VideoItem[] | null {
  if (typeof data.kind === 'string' && data.kind !== VIDEO_LIST_KIND) return null
  if (!Array.isArray(data.items)) return null

  const entries = data.items as unknown[]
  if (requestedIds.length > 0 && entries.length === 0) return null

  const requested = new Set(requestedIds)
  const result: VideoItem[] = []
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) return null
    const id = (entry as { id?: unknown }).id
    if (typeof id !== 'string' || !id) return null
    if (!requested.has(id)) return null
    result.push(entry as VideoItem)
  }
  return result
}

/**
 * Batch-fetches full video resources for the given IDs, keyed by video ID.
 *
 * Returns null when the response is untrusted (see `readTrustedVideoItems`) so the caller
 * can fail open instead of treating every ID as gone. Videos that are private, deleted,
 * or region-blocked are absent from a trusted response.
 */
async function fetchVideosByIds(
  apiKey: string,
  videoIds: string[],
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<Map<string, VideoItem> | null> {
  const result = new Map<string, VideoItem>()
  if (videoIds.length === 0) return result

  const data = await fetchVideoList(apiKey, videoIds, VIDEO_PART_FULL, retryOptions)
  const items = readTrustedVideoItems(data, videoIds)
  if (!items) return null

  for (const item of items) {
    if (item.id) result.set(item.id, item)
  }
  return result
}

/**
 * Batch-resolves which of the given video IDs still exist, via a lightweight
 * `videos.list?part=id` call (flat 1 quota unit, up to 50 IDs per call — a full
 * `playlistItems.list` page).
 *
 * Returns null when the response is untrusted, which callers read as "availability is
 * unknown, keep everything".
 */
async function fetchAvailableVideoIds(
  apiKey: string,
  videoIds: string[],
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<Set<string> | null> {
  if (videoIds.length === 0) return new Set<string>()

  const data = await fetchVideoList(apiKey, videoIds, VIDEO_PART_ID_ONLY, retryOptions)
  const items = readTrustedVideoItems(data, videoIds)
  if (!items) return null

  const result = new Set<string>()
  for (const item of items) {
    if (item.id) result.add(item.id)
  }
  return result
}

/**
 * Keeps only playlist items whose video is still available.
 *
 * A playlist item is a resource independent of the video it points at: when the video is
 * deleted or made private, `playlistItems.list` keeps returning a placeholder item
 * ("Deleted video" / "Private video") with the same `contentDetails.videoId`, and the API
 * exposes no request parameter to exclude them. Left in the listing, those placeholders
 * keep the stored document's externalId present on every full sync, so deletion
 * reconciliation (which hard-deletes only documents ABSENT from the listing) never purges
 * it — and hydration cannot clean it up either, since `videos.list` omits the video and
 * `getDocument` returns null, which the sync engine treats as last-known-good.
 *
 * Availability is therefore established positively, from a `videos.list` membership check:
 * an item is dropped only when its video ID is explicitly absent from a trusted response.
 * A null set means the membership check could not be trusted, and every item is kept —
 * keeping a stale placeholder is recoverable, hard-deleting a live document (and its
 * `userExcluded` flag) is not.
 */
export function filterAvailableItems<T extends PlaylistItem>(
  items: T[],
  availableVideoIds: ReadonlySet<string> | null
): T[] {
  if (!availableVideoIds) return items
  return items.filter((item) => availableVideoIds.has(getVideoId(item)))
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
  ...youtubeConnectorMeta,

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
      /**
       * When excluding Shorts we must know each video's duration, which is not exposed on
       * `playlistItems.list`. Resolve it here with a single batched `videos.list` call
       * (1 quota unit per page) and emit FULLY-HYDRATED documents. This is deliberate:
       * emitting deferred stubs for Shorts would make every excluded Short re-list as a
       * brand-new doc on every sync (it is never persisted), re-hydrating to null forever.
       * Filtering at listing time bounds the cost to one batched call per page per sync.
       *
       * An untrusted response cannot be read as "every video on this page is gone", and
       * durations are unavailable without it, so the page emits nothing and the listing is
       * marked truncated — which blocks deletion reconciliation for this sync absolutely.
       * Pagination still advances on the real `playlistItems` cursor.
       */
      const videoMap = await fetchVideosByIds(apiKey, keptItems.map(getVideoId))
      if (!videoMap) {
        logger.warn('Untrusted videos.list response; skipping page and blocking reconciliation', {
          playlistId,
          count: keptItems.length,
        })
        if (syncContext) {
          syncContext.listingCapped = true
          syncContext.listingTruncated = true
        }
      } else {
        for (const item of keptItems) {
          /**
           * Absent from a trusted `videos.list` => private/deleted/region-blocked. Drop it
           * instead of emitting a stub that would re-hydrate to null on every sync.
           */
          const video = videoMap.get(getVideoId(item))
          if (!video) continue
          const doc = videoToDocument(video, true)
          if (doc) documents.push(doc)
        }
      }
    } else if (keptItems.length > 0) {
      /**
       * Placeholder items for deleted/private videos stay in `playlistItems.list` forever
       * and would pin the stored document against deletion reconciliation. Resolve which
       * videos still exist with one batched `videos.list?part=id` call (1 quota unit per
       * page) and emit stubs only for those — mirroring the drop the excludeShorts branch
       * above already performs. An untrusted response keeps every item (fail open).
       */
      const availableVideoIds = await fetchAvailableVideoIds(apiKey, keptItems.map(getVideoId))
      if (!availableVideoIds) {
        logger.warn('Untrusted videos.list response; keeping all playlist items for this page', {
          playlistId,
          count: keptItems.length,
        })
      }
      for (const item of filterAvailableItems(keptItems, availableVideoIds)) {
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

    /**
     * Pagination is driven exclusively by the `playlistItems.list` cursor, never by how
     * many documents survived availability filtering. A page whose items are ALL
     * unavailable therefore emits zero documents while still advancing to the next page
     * and reporting `hasMore` truthfully, so it can neither wedge nor truncate the sync.
     */
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
