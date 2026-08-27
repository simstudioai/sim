import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { gongConnectorMeta } from '@/connectors/gong/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { joinTagArray, parseTagDate } from '@/connectors/utils'

const logger = createLogger('GongConnector')

const GONG_API_BASE = 'https://api.gong.io/v2'
const DEFAULT_LOOKBACK_DAYS = 90
const MAX_LOOKBACK_DAYS = 180
/**
 * Days of overlap added when computing the incremental sync window. Gong call data
 * (parties, transcript) can finish processing minutes to hours — occasionally a
 * day or two — after a call ends. The sync engine re-attempts calls whose
 * transcript was not yet ready (a null getDocument result is never persisted, so
 * the call is re-listed and re-fetched on the next sync), but only while the call
 * stays inside the incremental window. A two-week overlap keeps recently-ended
 * calls in that window long enough for late transcripts to be picked up, at the
 * cost of re-listing already-synced calls (skipped downstream by content hash).
 */
const INCREMENTAL_OVERLAP_DAYS = 14
const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Metadata for a single call participant. `speakerId` cross-references the
 * `speakerId` field on transcript monologues, letting the connector attribute
 * each spoken line to a named participant.
 */
interface GongParty {
  id?: string
  name?: string
  emailAddress?: string
  speakerId?: string
  affiliation?: string
}

/**
 * Core call metadata returned by the extensive calls endpoint. Mirrors Gong's
 * `CallBasicData` (the `metaData` object) — every field here is present on the
 * `/v2/calls/extensive` stub response and never requires the transcript fetch.
 */
interface GongCallMetaData {
  id?: string
  title?: string
  scheduled?: string
  started?: string
  duration?: number
  url?: string
  workspaceId?: string
  primaryUserId?: string
  direction?: string
  scope?: string
  system?: string
  language?: string
  purpose?: string
  isPrivate?: boolean
}

/**
 * A single call object from POST /v2/calls/extensive.
 */
interface GongExtensiveCall {
  metaData?: GongCallMetaData
  parties?: GongParty[]
}

interface GongRecords {
  cursor?: string
  totalRecords?: number
  currentPageSize?: number
}

interface GongExtensiveCallsResponse {
  calls?: GongExtensiveCall[]
  records?: GongRecords
}

/**
 * A single sentence within a transcript monologue. Gong returns timing in
 * `startMs`/`endMs`; only `text` is used for the formatted transcript.
 */
interface GongTranscriptSentence {
  text?: string
}

/**
 * A monologue (one speaker turn) within a call transcript.
 */
interface GongMonologue {
  speakerId?: string
  topic?: string
  sentences?: GongTranscriptSentence[]
}

interface GongCallTranscript {
  callId?: string
  transcript?: GongMonologue[]
}

interface GongTranscriptResponse {
  callTranscripts?: GongCallTranscript[]
  records?: GongRecords
}

/**
 * Builds the Authorization header value for Gong's Basic auth scheme.
 *
 * Gong authenticates with `Basic base64(accessKey:accessKeySecret)`. The sync
 * engine passes the user's stored key as `accessToken`. To support both raw
 * `accessKey:accessKeySecret` pairs and pre-encoded credentials, the raw form
 * (containing a colon) is base64-encoded here; an already-encoded value is sent
 * as-is.
 */
function buildAuthHeader(accessToken: string): string {
  const token = accessToken.includes(':')
    ? Buffer.from(accessToken, 'utf8').toString('base64')
    : accessToken
  return `Basic ${token}`
}

function buildHeaders(accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: buildAuthHeader(accessToken),
  }
}

/**
 * Parses a comma- or newline-separated list of Gong IDs into a trimmed,
 * de-duplicated, non-empty array. Returns `undefined` when nothing usable
 * remains so the caller can omit the filter key entirely.
 */
function parseIdList(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string') return undefined
  const ids = Array.from(
    new Set(
      raw
        .split(/[\n,]/)
        .map((value) => value.trim())
        .filter((value) => value.length > 0)
    )
  )
  return ids.length > 0 ? ids : undefined
}

/**
 * Metadata-based content hash shared by `listDocuments` stubs and `getDocument`
 * results. Derived purely from call identity and its start time so the value is
 * identical across both paths — guaranteeing the sync engine only re-fetches a
 * transcript when the call's metadata actually changes.
 */
function buildContentHash(callId: string, started: string | undefined): string {
  return `gong:${callId}:${started ?? ''}`
}

function buildCallTitle(metaData: GongCallMetaData | undefined): string {
  return metaData?.title?.trim() || 'Untitled Gong Call'
}

/**
 * Extracts named participant labels from a call's parties for tag mapping and
 * the transcript header.
 */
function buildParticipantNames(parties: GongParty[] | undefined): string[] {
  if (!parties) return []
  const names: string[] = []
  for (const party of parties) {
    const label = party.name?.trim() || party.emailAddress?.trim()
    if (label) names.push(label)
  }
  return names
}

/**
 * Builds a `speakerId` → display-name map from a call's parties so transcript
 * monologues (keyed by `speakerId`) can be attributed to a named speaker.
 */
function buildSpeakerMap(parties: GongParty[] | undefined): Record<string, string> {
  const map: Record<string, string> = {}
  if (!parties) return map
  for (const party of parties) {
    if (!party.speakerId) continue
    const label = party.name?.trim() || party.emailAddress?.trim()
    if (label) map[party.speakerId] = label
  }
  return map
}

function buildMetadata(
  metaData: GongCallMetaData | undefined,
  participants: string[]
): Record<string, unknown> {
  return {
    callId: metaData?.id,
    callTitle: metaData?.title,
    callDate: metaData?.started,
    scheduledDate: metaData?.scheduled,
    duration: metaData?.duration,
    workspaceId: metaData?.workspaceId,
    primaryUserId: metaData?.primaryUserId,
    direction: metaData?.direction,
    scope: metaData?.scope,
    system: metaData?.system,
    language: metaData?.language,
    purpose: metaData?.purpose,
    isPrivate: metaData?.isPrivate,
    participants,
  }
}

/**
 * Everything about a call that is derivable from the listing response alone.
 * Cached in `syncContext` by `listDocuments` so the deferred-content fetch in
 * `getDocument` does not have to re-request `/v2/calls/extensive` for metadata
 * it already had — halving the request volume against Gong's 3 req/s quota.
 */
interface GongCallHeader {
  id: string
  title: string
  sourceUrl?: string
  contentHash: string
  started?: string
  duration?: number
  participants: string[]
  speakerMap: Record<string, string>
  metadata: Record<string, unknown>
}

/**
 * Upper bound on cached call headers. A sync lists every call before hydrating
 * any of them, so an uncapped cache would hold the whole workspace in memory.
 * Headers past the cap simply miss and fall back to a per-call API request.
 */
const CALL_HEADER_CACHE_LIMIT = 5000

function buildCallHeader(call: GongExtensiveCall): GongCallHeader | null {
  const metaData = call.metaData
  const callId = metaData?.id
  if (!callId) return null
  const participants = buildParticipantNames(call.parties)
  return {
    id: callId,
    title: buildCallTitle(metaData),
    sourceUrl: metaData?.url || undefined,
    contentHash: buildContentHash(callId, metaData?.started),
    started: metaData?.started,
    duration: metaData?.duration,
    participants,
    speakerMap: buildSpeakerMap(call.parties),
    metadata: buildMetadata(metaData, participants),
  }
}

/**
 * Reads the cached header for a call out of the shared sync context.
 */
function readCachedHeader(
  syncContext: Record<string, unknown> | undefined,
  callId: string
): GongCallHeader | undefined {
  const cache = syncContext?.gongCallHeaders as Map<string, GongCallHeader> | undefined
  return cache?.get(callId)
}

/**
 * Stores the header for a call in the shared sync context, up to the cache cap.
 */
function cacheHeader(
  syncContext: Record<string, unknown> | undefined,
  header: GongCallHeader
): void {
  if (!syncContext) return
  let cache = syncContext.gongCallHeaders as Map<string, GongCallHeader> | undefined
  if (!cache) {
    cache = new Map()
    syncContext.gongCallHeaders = cache
  }
  if (cache.size >= CALL_HEADER_CACHE_LIMIT && !cache.has(header.id)) return
  cache.set(header.id, header)
}

/**
 * Formats a call's transcript into speaker-attributed plain text with a header
 * describing the call (title, date, duration, participants).
 */
function formatTranscriptContent(header: GongCallHeader, monologues: GongMonologue[]): string {
  const parts: string[] = []
  const { participants, speakerMap } = header

  parts.push(`Call: ${header.title}`)
  if (header.started) parts.push(`Date: ${header.started}`)
  if (header.duration != null) {
    const minutes = Math.round(header.duration / 60)
    parts.push(`Duration: ${minutes} minutes`)
  }
  if (participants.length > 0) parts.push(`Participants: ${participants.join(', ')}`)

  parts.push('')
  parts.push('--- Transcript ---')

  for (const monologue of monologues) {
    const speaker = (monologue.speakerId && speakerMap[monologue.speakerId]) || 'Unknown Speaker'
    const text = (monologue.sentences ?? [])
      .map((sentence) => sentence.text?.trim())
      .filter((value): value is string => Boolean(value))
      .join(' ')
    if (text) parts.push(`${speaker}: ${text}`)
  }

  return parts.join('\n')
}

/**
 * Computes the effective lookback window in days, narrowing to the time since
 * the last successful sync (plus an overlap to catch transcripts that finished
 * processing late) when incremental sync is active.
 */
function computeLookbackDays(
  sourceConfig: Record<string, unknown>,
  lastSyncAt: Date | undefined
): number {
  const raw = sourceConfig.lookback as string | undefined
  const configured = Number(raw)
  const baseline =
    Number.isFinite(configured) && configured > 0
      ? Math.min(Math.floor(configured), MAX_LOOKBACK_DAYS)
      : DEFAULT_LOOKBACK_DAYS

  if (!lastSyncAt) return baseline

  const sinceLastSync = Math.ceil((Date.now() - lastSyncAt.getTime()) / MS_PER_DAY)
  const incremental = Math.max(sinceLastSync + INCREMENTAL_OVERLAP_DAYS, INCREMENTAL_OVERLAP_DAYS)
  return Math.min(incremental, baseline)
}

/**
 * Fetches a single page of calls from POST /v2/calls/extensive with parties
 * exposed (needed to resolve transcript speaker IDs to names).
 */
async function fetchExtensiveCalls(
  accessToken: string,
  filter: Record<string, unknown>,
  cursor: string | undefined,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<GongExtensiveCallsResponse> {
  const body: Record<string, unknown> = {
    filter,
    contentSelector: { exposedFields: { parties: true } },
  }
  if (cursor) body.cursor = cursor

  const response = await fetchWithRetry(
    `${GONG_API_BASE}/calls/extensive`,
    {
      method: 'POST',
      headers: buildHeaders(accessToken),
      body: JSON.stringify(body),
    },
    retryOptions
  )

  /**
   * Gong answers a filter that matches no calls with `404 No calls found for the
   * specified period` rather than an empty list — the documented 404 for
   * `/v2/calls/extensive`. That is an ordinary outcome for a narrow incremental
   * window, so it maps to an empty page instead of failing the sync.
   */
  if (response.status === 404) return { calls: [] }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(
      `Failed to list Gong calls: ${response.status}${errorText ? ` — ${errorText.slice(0, 200)}` : ''}`
    )
  }

  return (await response.json()) as GongExtensiveCallsResponse
}

export const gongConnector: ConnectorConfig = {
  ...gongConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>,
    lastSyncAt?: Date
  ): Promise<ExternalDocumentList> => {
    const lookbackDays = computeLookbackDays(sourceConfig, lastSyncAt)
    const maxCalls = sourceConfig.maxCalls ? Number(sourceConfig.maxCalls) : 0
    const workspaceId = (sourceConfig.workspaceId as string | undefined)?.trim()
    const primaryUserIds = parseIdList(sourceConfig.primaryUserIds)

    const cachedWindow = syncContext?.gongDateWindow as
      | { fromDateTime: string; toDateTime: string }
      | undefined
    const now = new Date()
    const window = cachedWindow ?? {
      fromDateTime: new Date(now.getTime() - lookbackDays * MS_PER_DAY).toISOString(),
      toDateTime: now.toISOString(),
    }
    if (syncContext && !cachedWindow) syncContext.gongDateWindow = window
    const { fromDateTime, toDateTime } = window

    const filter: Record<string, unknown> = { fromDateTime, toDateTime }
    if (workspaceId) filter.workspaceId = workspaceId
    if (primaryUserIds) filter.primaryUserIds = primaryUserIds

    logger.info('Listing Gong calls', {
      fromDateTime,
      toDateTime,
      hasCursor: Boolean(cursor),
      incremental: Boolean(lastSyncAt),
    })

    const data = await fetchExtensiveCalls(accessToken, filter, cursor)
    const calls = data.calls ?? []
    const nextPageCursor = data.records?.cursor?.trim() || undefined

    const allDocuments: ExternalDocument[] = []
    for (const call of calls) {
      const header = buildCallHeader(call)
      if (!header) continue
      cacheHeader(syncContext, header)
      allDocuments.push({
        externalId: header.id,
        title: header.title,
        content: '',
        contentDeferred: true,
        mimeType: 'text/plain',
        sourceUrl: header.sourceUrl,
        contentHash: header.contentHash,
        metadata: header.metadata,
      })
    }

    const prevFetched = (syncContext?.totalDocsFetched as number) ?? 0
    let documents = allDocuments
    let capDroppedDocs = false
    if (maxCalls > 0) {
      const remaining = Math.max(0, maxCalls - prevFetched)
      if (allDocuments.length > remaining) {
        documents = allDocuments.slice(0, remaining)
        capDroppedDocs = true
      }
    }

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = maxCalls > 0 && totalFetched >= maxCalls
    const hasMore = !hitLimit && Boolean(nextPageCursor)

    /**
     * Only flag the listing as capped when the `maxCalls` limit actually
     * truncated calls that still exist in the source — either by dropping calls
     * from the current page or by stopping while another page remains. Reaching
     * the limit exactly at source exhaustion (no dropped calls, no further
     * cursor) yields a complete listing, so deletion reconciliation must still
     * run for calls removed in Gong.
     */
    if (syncContext && (capDroppedDocs || (hitLimit && Boolean(nextPageCursor)))) {
      syncContext.listingCapped = true
    }

    return {
      documents,
      nextCursor: hasMore ? nextPageCursor : undefined,
      hasMore,
    }
  },

  /**
   * Hydrates a listing stub with its transcript.
   *
   * Returns `null` only when the call genuinely has nothing to index yet (call
   * gone, transcript still processing). Transport, rate-limit, and server errors
   * propagate so the sync engine records them as failed documents instead of
   * reporting a clean sync that silently dropped calls.
   */
  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    if (!externalId) return null

    let header = readCachedHeader(syncContext, externalId)
    if (!header) {
      const workspaceId = (sourceConfig.workspaceId as string | undefined)?.trim()
      const filter: Record<string, unknown> = { callIds: [externalId] }
      if (workspaceId) filter.workspaceId = workspaceId

      const callData = await fetchExtensiveCalls(accessToken, filter, undefined)
      const call = callData.calls?.[0]
      const fetchedHeader = call ? buildCallHeader(call) : null
      if (!fetchedHeader) {
        logger.warn('Gong call not found', { externalId })
        return null
      }
      header = fetchedHeader
      cacheHeader(syncContext, header)
    }

    const transcriptResponse = await fetchWithRetry(`${GONG_API_BASE}/calls/transcript`, {
      method: 'POST',
      headers: buildHeaders(accessToken),
      body: JSON.stringify({ filter: { callIds: [externalId] } }),
    })

    if (!transcriptResponse.ok) {
      if (transcriptResponse.status === 404) return null
      const errorText = await transcriptResponse.text().catch(() => '')
      throw new Error(
        `Failed to fetch Gong transcript: ${transcriptResponse.status}${errorText ? ` — ${errorText.slice(0, 200)}` : ''}`
      )
    }

    const transcriptData = (await transcriptResponse.json()) as GongTranscriptResponse
    const callTranscript = transcriptData.callTranscripts?.find(
      (entry) => entry.callId === externalId
    )
    const monologues = callTranscript?.transcript ?? []

    const hasSpokenText = monologues.some((monologue) =>
      (monologue.sentences ?? []).some((sentence) => Boolean(sentence.text?.trim()))
    )
    if (!hasSpokenText) {
      logger.info('Transcript not available for Gong call', { externalId })
      return null
    }

    return {
      externalId,
      title: header.title,
      content: formatTranscriptContent(header, monologues),
      contentDeferred: false,
      mimeType: 'text/plain',
      sourceUrl: header.sourceUrl,
      contentHash: header.contentHash,
      metadata: header.metadata,
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const maxCalls = sourceConfig.maxCalls as string | undefined
    if (maxCalls && (Number.isNaN(Number(maxCalls)) || Number(maxCalls) < 0)) {
      return { valid: false, error: 'Max calls must be a non-negative number' }
    }

    try {
      /**
       * Probes the calls listing — the exact resource the sync reads — over a
       * one-hour window so the check stays cheap. Probing `/v2/users` instead
       * would pass for a key that lacks call-read access and only fail later,
       * mid-sync.
       */
      const toDateTime = new Date()
      const fromDateTime = new Date(toDateTime.getTime() - 60 * 60 * 1000)
      const query = new URLSearchParams({
        fromDateTime: fromDateTime.toISOString(),
        toDateTime: toDateTime.toISOString(),
      })
      const workspaceId = (sourceConfig.workspaceId as string | undefined)?.trim()
      if (workspaceId) query.set('workspaceId', workspaceId)

      const response = await fetchWithRetry(
        `${GONG_API_BASE}/calls?${query.toString()}`,
        {
          method: 'GET',
          headers: buildHeaders(accessToken),
        },
        VALIDATE_RETRY_OPTIONS
      )

      /**
       * `GET /v2/calls` documents `404 No calls found for the specified period`
       * for a range that matches nothing. Most workspaces record nothing in any
       * given hour, so a 404 here proves the credential authenticated and was
       * allowed to query calls — a missing scope returns 401/403 instead.
       */
      if (response.status === 404) return { valid: true }

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return {
          valid: false,
          error: `Gong access failed: ${response.status}${errorText ? ` — ${errorText.slice(0, 200)}` : ''}`,
        }
      }

      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.callTitle === 'string' && metadata.callTitle.trim()) {
      result.callTitle = metadata.callTitle
    }

    const participants = joinTagArray(metadata.participants)
    if (participants) result.participants = participants

    if (metadata.duration != null) {
      const num = Number(metadata.duration)
      if (!Number.isNaN(num)) result.duration = num
    }

    const callDate = parseTagDate(metadata.callDate)
    if (callDate) result.callDate = callDate

    const scheduledDate = parseTagDate(metadata.scheduledDate)
    if (scheduledDate) result.scheduledDate = scheduledDate

    const textTags = ['direction', 'scope', 'system', 'language', 'purpose'] as const
    for (const key of textTags) {
      const value = metadata[key]
      if (typeof value === 'string' && value.trim()) result[key] = value.trim()
    }

    if (typeof metadata.isPrivate === 'boolean') result.isPrivate = metadata.isPrivate

    return result
  },
}
