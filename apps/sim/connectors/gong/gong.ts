import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { GongIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseTagDate } from '@/connectors/utils'

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
 * Formats a call's transcript into speaker-attributed plain text with a header
 * describing the call (title, date, duration, participants).
 */
function formatTranscriptContent(
  metaData: GongCallMetaData | undefined,
  participants: string[],
  speakerMap: Record<string, string>,
  monologues: GongMonologue[]
): string {
  const parts: string[] = []

  parts.push(`Call: ${buildCallTitle(metaData)}`)
  if (metaData?.started) parts.push(`Date: ${metaData.started}`)
  if (metaData?.duration != null) {
    const minutes = Math.round(metaData.duration / 60)
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

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    throw new Error(
      `Failed to list Gong calls: ${response.status}${errorText ? ` — ${errorText.slice(0, 200)}` : ''}`
    )
  }

  return (await response.json()) as GongExtensiveCallsResponse
}

export const gongConnector: ConnectorConfig = {
  id: 'gong',
  name: 'Gong',
  description: 'Sync call transcripts from Gong revenue intelligence',
  version: '1.0.0',
  icon: GongIcon,

  auth: {
    mode: 'apiKey',
    label: 'Access Key & Secret',
    placeholder: 'accessKey:accessKeySecret',
  },

  supportsIncrementalSync: true,

  configFields: [
    {
      id: 'lookback',
      title: 'Date Range',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'Last 30 days', id: '30' },
        { label: 'Last 90 days (recommended)', id: '90' },
        { label: 'Last 6 months', id: '180' },
      ],
      description:
        'On initial sync only. Controls how far back to look for calls with transcripts.',
    },
    {
      id: 'maxCalls',
      title: 'Max Calls',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 200 (default: unlimited)',
    },
    {
      id: 'workspaceId',
      title: 'Workspace ID',
      type: 'short-input',
      required: false,
      placeholder: 'Optional — limit to a single Gong workspace',
    },
    {
      id: 'primaryUserIds',
      title: 'Host User IDs',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'Optional — comma-separated Gong user IDs (call hosts)',
      description:
        'Only sync calls hosted by these users. Find IDs in Gong under Company Settings → Users, or via the API.',
    },
  ],

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
      const callId = call.metaData?.id
      if (!callId) continue
      const participants = buildParticipantNames(call.parties)
      allDocuments.push({
        externalId: callId,
        title: buildCallTitle(call.metaData),
        content: '',
        contentDeferred: true,
        mimeType: 'text/plain',
        sourceUrl: call.metaData?.url || undefined,
        contentHash: buildContentHash(callId, call.metaData?.started),
        metadata: buildMetadata(call.metaData, participants),
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

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    try {
      if (!externalId) return null

      const workspaceId = (sourceConfig.workspaceId as string | undefined)?.trim()
      const filter: Record<string, unknown> = { callIds: [externalId] }
      if (workspaceId) filter.workspaceId = workspaceId

      const callData = await fetchExtensiveCalls(accessToken, filter, undefined)
      const call = callData.calls?.[0]
      if (!call?.metaData?.id) {
        logger.warn('Gong call not found', { externalId })
        return null
      }

      const metaData = call.metaData
      const participants = buildParticipantNames(call.parties)
      const speakerMap = buildSpeakerMap(call.parties)

      const transcriptResponse = await fetchWithRetry(`${GONG_API_BASE}/calls/transcript`, {
        method: 'POST',
        headers: buildHeaders(accessToken),
        body: JSON.stringify({ filter: { callIds: [externalId] } }),
      })

      if (!transcriptResponse.ok) {
        if (transcriptResponse.status === 404) return null
        throw new Error(`Failed to fetch Gong transcript: ${transcriptResponse.status}`)
      }

      const transcriptData = (await transcriptResponse.json()) as GongTranscriptResponse
      const callTranscript = transcriptData.callTranscripts?.find(
        (entry) => entry.callId === externalId
      )
      const monologues = callTranscript?.transcript ?? []
      if (monologues.length === 0) {
        logger.info('Transcript not available for Gong call', { externalId })
        return null
      }

      const hasSpokenText = monologues.some((monologue) =>
        (monologue.sentences ?? []).some((sentence) => Boolean(sentence.text?.trim()))
      )
      if (!hasSpokenText) return null

      const content = formatTranscriptContent(metaData, participants, speakerMap, monologues)

      return {
        externalId: metaData.id ?? externalId,
        title: buildCallTitle(metaData),
        content,
        contentDeferred: false,
        mimeType: 'text/plain',
        sourceUrl: metaData.url || undefined,
        contentHash: buildContentHash(metaData.id ?? externalId, metaData.started),
        metadata: buildMetadata(metaData, participants),
      }
    } catch (error) {
      logger.warn('Failed to get Gong call transcript', {
        externalId,
        error: toError(error).message,
      })
      return null
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
      const response = await fetchWithRetry(
        `${GONG_API_BASE}/users`,
        {
          method: 'GET',
          headers: buildHeaders(accessToken),
        },
        VALIDATE_RETRY_OPTIONS
      )

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

  tagDefinitions: [
    { id: 'callTitle', displayName: 'Call Title', fieldType: 'text' },
    { id: 'participants', displayName: 'Participants', fieldType: 'text' },
    { id: 'duration', displayName: 'Duration (seconds)', fieldType: 'number' },
    { id: 'callDate', displayName: 'Call Date', fieldType: 'date' },
    { id: 'scheduledDate', displayName: 'Scheduled Date', fieldType: 'date' },
    { id: 'direction', displayName: 'Direction', fieldType: 'text' },
    { id: 'scope', displayName: 'Scope', fieldType: 'text' },
    { id: 'system', displayName: 'System', fieldType: 'text' },
    { id: 'language', displayName: 'Language', fieldType: 'text' },
    { id: 'purpose', displayName: 'Purpose', fieldType: 'text' },
    { id: 'isPrivate', displayName: 'Private', fieldType: 'boolean' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.callTitle === 'string' && metadata.callTitle.trim()) {
      result.callTitle = metadata.callTitle
    }

    const participants = Array.isArray(metadata.participants)
      ? (metadata.participants as string[])
      : []
    if (participants.length > 0) {
      result.participants = participants.join(', ')
    }

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
