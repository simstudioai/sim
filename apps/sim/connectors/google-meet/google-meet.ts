import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { googleMeetConnectorMeta } from '@/connectors/google-meet/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { joinTagArray, parseTagDate } from '@/connectors/utils'

const logger = createLogger('GoogleMeetConnector')

const MEET_API_BASE = 'https://meet.googleapis.com/v2'
const MS_PER_DAY = 24 * 60 * 60 * 1000
/** Conference records list page size (Meet API max is 100). */
const RECORDS_PAGE_SIZE = 100
/** Transcripts list page size (Meet API max is 100). */
const TRANSCRIPTS_PAGE_SIZE = 100
/** Transcript entries page size (Meet API max is 100). */
const ENTRIES_PAGE_SIZE = 100
/** Max concurrent participant-name lookups during a single getDocument call. */
const PARTICIPANT_FETCH_CONCURRENCY = 5

/**
 * A conference record as returned by the Meet REST API v2. A conference record
 * represents a single meeting session and is immutable once it has ended. Only the
 * fields the connector reads are modeled.
 */
interface ConferenceRecord {
  name: string
  startTime?: string
  endTime?: string | null
  expireTime?: string
  space?: string
}

interface ConferenceRecordsListResponse {
  conferenceRecords?: ConferenceRecord[]
  nextPageToken?: string
}

/**
 * The Google Doc a transcript is exported to once its `state` reaches
 * `FILE_GENERATED`. Used to link the synced document back to the source transcript.
 */
interface DocsDestination {
  document?: string
  exportUri?: string
}

/**
 * A transcript of a conference record. `state` progresses STARTED → ENDED →
 * FILE_GENERATED; entries are only complete once the session has ended.
 */
interface Transcript {
  name: string
  state?: 'STATE_UNSPECIFIED' | 'STARTED' | 'ENDED' | 'FILE_GENERATED'
  startTime?: string
  endTime?: string
  docsDestination?: DocsDestination
}

interface TranscriptsListResponse {
  transcripts?: Transcript[]
  nextPageToken?: string
}

/**
 * A single speaker-attributed segment of a transcript. `participant` is the resource
 * name of the speaking participant (resolved to a display name separately).
 */
interface TranscriptEntry {
  name: string
  participant?: string
  text?: string
  languageCode?: string
  startTime?: string
  endTime?: string
}

interface TranscriptEntriesListResponse {
  transcriptEntries?: TranscriptEntry[]
  nextPageToken?: string
}

/**
 * A meeting participant. The Meet API uses a oneof for the identity — exactly one of
 * `signedinUser`, `anonymousUser`, or `phoneUser` is populated, each carrying a
 * `displayName`.
 */
interface Participant {
  name: string
  signedinUser?: { user?: string; displayName?: string }
  anonymousUser?: { displayName?: string }
  phoneUser?: { displayName?: string }
}

function meetHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` }
}

/**
 * Normalizes a conference record identifier to its full resource name
 * (`conferenceRecords/{id}`), tolerating a bare id.
 */
function conferenceResourceName(externalId: string): string {
  const trimmed = externalId.trim()
  return trimmed.startsWith('conferenceRecords/') ? trimmed : `conferenceRecords/${trimmed}`
}

/**
 * Derives a stable, human-readable title for a meeting. Conference records carry no
 * title, so the meeting's start date is used.
 */
function recordTitle(record: ConferenceRecord): string {
  const date = record.startTime?.slice(0, 10)
  return date ? `Google Meet — ${date}` : 'Google Meet meeting'
}

/**
 * Computes the meeting duration in whole minutes, or undefined when the meeting has
 * not ended or timestamps are missing.
 */
function recordDurationMinutes(record: ConferenceRecord): number | undefined {
  if (!record.startTime || !record.endTime) return undefined
  const start = new Date(record.startTime).getTime()
  const end = new Date(record.endTime).getTime()
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return undefined
  return Math.round((end - start) / 60000)
}

/**
 * Computes the metadata-based change-detection hash for a conference record. Records
 * are immutable once ended, so the end time fully captures the final state; an
 * in-progress meeting (no end time) re-syncs once it ends and the hash changes. The
 * identical formula is used for both the listing stub and the fetched document.
 */
function buildContentHash(record: ConferenceRecord): string {
  return `gmeet:${record.name}:${record.endTime ?? ''}`
}

/**
 * Builds the deferred listing stub for a conference record. Transcript content is
 * fetched lazily in getDocument; only metadata and the change hash are computed here.
 */
function recordToStub(record: ConferenceRecord): ExternalDocument {
  return {
    externalId: record.name,
    title: recordTitle(record),
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    contentHash: buildContentHash(record),
    metadata: {
      meetingDate: record.startTime,
      duration: recordDurationMinutes(record),
    },
  }
}

/**
 * Returns a transcript entry's start time as epoch milliseconds for chronological
 * sorting. Entries without a parseable start time sort last (stably).
 */
function entryStartMs(entry: TranscriptEntry): number {
  if (!entry.startTime) return Number.POSITIVE_INFINITY
  const ms = new Date(entry.startTime).getTime()
  return Number.isNaN(ms) ? Number.POSITIVE_INFINITY : ms
}

/**
 * Resolves a participant's display name across the identity oneof, falling back to a
 * stable placeholder when no name is exposed (e.g. anonymous joins).
 */
function participantDisplayName(participant: Participant): string {
  return (
    participant.signedinUser?.displayName?.trim() ||
    participant.anonymousUser?.displayName?.trim() ||
    participant.phoneUser?.displayName?.trim() ||
    'Unknown'
  )
}

/**
 * Fetches a single conference record. Returns null on 404 (record expired/deleted).
 */
async function fetchConferenceRecord(
  accessToken: string,
  name: string
): Promise<ConferenceRecord | null> {
  const response = await fetchWithRetry(`${MEET_API_BASE}/${name}`, {
    method: 'GET',
    headers: meetHeaders(accessToken),
  })
  if (!response.ok) {
    if (response.status === 404) return null
    throw new Error(`Failed to fetch Google Meet conference record: ${response.status}`)
  }
  return (await response.json()) as ConferenceRecord
}

/**
 * Lists every transcript belonging to a conference record, following pagination.
 */
async function fetchTranscripts(accessToken: string, recordName: string): Promise<Transcript[]> {
  const transcripts: Transcript[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ pageSize: String(TRANSCRIPTS_PAGE_SIZE) })
    if (pageToken) params.set('pageToken', pageToken)
    const response = await fetchWithRetry(
      `${MEET_API_BASE}/${recordName}/transcripts?${params.toString()}`,
      { method: 'GET', headers: meetHeaders(accessToken) }
    )
    if (!response.ok) {
      if (response.status === 404) break
      throw new Error(`Failed to list Google Meet transcripts: ${response.status}`)
    }
    const data = (await response.json()) as TranscriptsListResponse
    if (data.transcripts) transcripts.push(...data.transcripts)
    pageToken = data.nextPageToken
  } while (pageToken)
  return transcripts
}

/**
 * Lists every entry of a transcript, following pagination. Entries are returned in
 * chronological order by the API.
 */
async function fetchTranscriptEntries(
  accessToken: string,
  transcriptName: string
): Promise<TranscriptEntry[]> {
  const entries: TranscriptEntry[] = []
  let pageToken: string | undefined
  do {
    const params = new URLSearchParams({ pageSize: String(ENTRIES_PAGE_SIZE) })
    if (pageToken) params.set('pageToken', pageToken)
    const response = await fetchWithRetry(
      `${MEET_API_BASE}/${transcriptName}/entries?${params.toString()}`,
      { method: 'GET', headers: meetHeaders(accessToken) }
    )
    if (!response.ok) {
      if (response.status === 404) break
      throw new Error(`Failed to list Google Meet transcript entries: ${response.status}`)
    }
    const data = (await response.json()) as TranscriptEntriesListResponse
    if (data.transcriptEntries) entries.push(...data.transcriptEntries)
    pageToken = data.nextPageToken
  } while (pageToken)
  return entries
}

/**
 * Resolves the display names for a set of participant resource names, returning a map
 * keyed by resource name. Participants that fail to resolve are omitted so the caller
 * falls back to a placeholder.
 */
async function resolveParticipantNames(
  accessToken: string,
  participantNames: string[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  for (let i = 0; i < participantNames.length; i += PARTICIPANT_FETCH_CONCURRENCY) {
    const batch = participantNames.slice(i, i + PARTICIPANT_FETCH_CONCURRENCY)
    await Promise.all(
      batch.map(async (name) => {
        try {
          const response = await fetchWithRetry(`${MEET_API_BASE}/${name}`, {
            method: 'GET',
            headers: meetHeaders(accessToken),
          })
          if (!response.ok) return
          const participant = (await response.json()) as Participant
          map.set(name, participantDisplayName(participant))
        } catch (error) {
          logger.warn('Failed to resolve Google Meet participant', {
            participant: name,
            error: toError(error).message,
          })
        }
      })
    )
  }
  return map
}

/**
 * Formats a meeting header plus speaker-attributed transcript lines into plain text.
 */
function formatTranscriptContent(
  record: ConferenceRecord,
  entries: TranscriptEntry[],
  participantNames: Map<string, string>
): string {
  const parts: string[] = []
  parts.push(`Meeting: ${recordTitle(record)}`)
  if (record.startTime) parts.push(`Date: ${record.startTime}`)
  const minutes = recordDurationMinutes(record)
  if (minutes != null) parts.push(`Duration: ${minutes} minutes`)

  const speakers = Array.from(
    new Set(
      entries
        .map((entry) => (entry.participant ? participantNames.get(entry.participant) : undefined))
        .filter((name): name is string => Boolean(name))
    )
  )
  if (speakers.length > 0) parts.push(`Participants: ${speakers.join(', ')}`)

  parts.push('')
  parts.push('--- Transcript ---')
  for (const entry of entries) {
    const text = entry.text?.trim()
    if (!text) continue
    const speaker = (entry.participant && participantNames.get(entry.participant)) || 'Unknown'
    parts.push(`${speaker}: ${text}`)
  }

  return parts.join('\n')
}

/**
 * Builds the conference records list `filter` from the connector's scoping config.
 * Only the documented `start_time` filter is emitted, and only when a lookback window
 * is configured (full sync otherwise).
 */
function buildRecordsFilter(sourceConfig: Record<string, unknown>): string | undefined {
  const lookbackDays = sourceConfig.lookbackDays ? Number(sourceConfig.lookbackDays) : 0
  if (!Number.isFinite(lookbackDays) || lookbackDays <= 0) return undefined
  const since = new Date(Date.now() - lookbackDays * MS_PER_DAY).toISOString()
  return `start_time >= "${since}"`
}

export const googleMeetConnector: ConnectorConfig = {
  ...googleMeetConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const maxMeetings = sourceConfig.maxMeetings ? Number(sourceConfig.maxMeetings) : 0
    const prevFetched = (syncContext?.totalDocsFetched as number) ?? 0

    const pageSize =
      maxMeetings > 0
        ? Math.min(RECORDS_PAGE_SIZE, Math.max(1, maxMeetings - prevFetched))
        : RECORDS_PAGE_SIZE
    const params = new URLSearchParams({ pageSize: String(pageSize) })
    if (cursor) params.set('pageToken', cursor)
    const filter = buildRecordsFilter(sourceConfig)
    if (filter) params.set('filter', filter)

    logger.info('Listing Google Meet conference records', {
      hasCursor: Boolean(cursor),
      hasFilter: Boolean(filter),
    })

    const response = await fetchWithRetry(
      `${MEET_API_BASE}/conferenceRecords?${params.toString()}`,
      { method: 'GET', headers: meetHeaders(accessToken) }
    )

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error('Failed to list Google Meet conference records', {
        status: response.status,
        error: errorText.slice(0, 500),
      })
      throw new Error(`Failed to list Google Meet conference records: ${response.status}`)
    }

    const data = (await response.json()) as ConferenceRecordsListResponse
    const records = data.conferenceRecords ?? []
    const nextPageToken = data.nextPageToken?.trim() || undefined

    const allDocuments = records
      .filter((record) => Boolean(record.name))
      .map((record) => recordToStub(record))

    let documents = allDocuments
    if (maxMeetings > 0) {
      const remaining = Math.max(0, maxMeetings - prevFetched)
      if (allDocuments.length > remaining) documents = allDocuments.slice(0, remaining)
    }

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const reachedCap = maxMeetings > 0 && totalFetched >= maxMeetings

    // Only flag the listing as capped when the cap actually truncated a larger source —
    // either more pages remain, or records were dropped from this page. If the source
    // was fully listed and merely happens to equal the cap, leave it unflagged so the
    // sync engine still reconciles deletions of meetings that disappear upstream.
    const truncated =
      reachedCap && (Boolean(nextPageToken) || allDocuments.length > documents.length)
    if (truncated && syncContext) syncContext.listingCapped = true

    const hasMore = !reachedCap && Boolean(nextPageToken)

    return {
      documents,
      nextCursor: hasMore ? nextPageToken : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    try {
      if (!externalId) return null
      const recordName = conferenceResourceName(externalId)

      const record = await fetchConferenceRecord(accessToken, recordName)
      if (!record) return null

      const transcripts = await fetchTranscripts(accessToken, recordName)
      if (transcripts.length === 0) return null

      // Only index once every transcript is fully generated. Before then the entry set
      // is still being populated, and because the content hash is keyed on the (now
      // fixed) conference endTime, a partial transcript stored here would never be
      // refreshed on later syncs. Waiting for FILE_GENERATED keeps indexed content final.
      if (transcripts.some((transcript) => transcript.state !== 'FILE_GENERATED')) {
        logger.info('Google Meet transcript not finalized yet', { externalId })
        return null
      }

      const entryGroups = await Promise.all(
        transcripts.map((transcript) => fetchTranscriptEntries(accessToken, transcript.name))
      )
      // The API guarantees chronological order only within a single transcript, so sort
      // the merged entries by start time to keep speaker lines in sequence when a
      // conference has more than one transcript.
      const entries = entryGroups.flat().sort((a, b) => entryStartMs(a) - entryStartMs(b))

      const hasText = entries.some((entry) => entry.text?.trim())
      if (!hasText) {
        logger.info('Transcript not yet available for Google Meet conference', { externalId })
        return null
      }

      const participantNames = await resolveParticipantNames(
        accessToken,
        Array.from(
          new Set(
            entries
              .map((entry) => entry.participant)
              .filter((name): name is string => Boolean(name))
          )
        )
      )

      const content = formatTranscriptContent(record, entries, participantNames)
      const sourceUrl = transcripts.find((t) => t.docsDestination?.exportUri)?.docsDestination
        ?.exportUri

      const speakers = Array.from(new Set(Array.from(participantNames.values())))

      return {
        externalId: record.name,
        title: recordTitle(record),
        content,
        contentDeferred: false,
        mimeType: 'text/plain',
        sourceUrl: sourceUrl || undefined,
        contentHash: buildContentHash(record),
        metadata: {
          meetingDate: record.startTime,
          duration: recordDurationMinutes(record),
          participants: speakers,
        },
      }
    } catch (error) {
      logger.warn('Failed to get Google Meet transcript', {
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
    const maxMeetings = sourceConfig.maxMeetings as string | undefined
    if (maxMeetings && (Number.isNaN(Number(maxMeetings)) || Number(maxMeetings) < 0)) {
      return { valid: false, error: 'Max meetings must be a non-negative number' }
    }

    const lookbackDays = sourceConfig.lookbackDays as string | undefined
    if (lookbackDays && (Number.isNaN(Number(lookbackDays)) || Number(lookbackDays) < 0)) {
      return { valid: false, error: 'Lookback window must be a non-negative number of days' }
    }

    try {
      const response = await fetchWithRetry(
        `${MEET_API_BASE}/conferenceRecords?pageSize=1`,
        { method: 'GET', headers: meetHeaders(accessToken) },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return {
          valid: false,
          error: `Google Meet access failed: ${response.status}${errorText ? ` — ${errorText.slice(0, 200)}` : ''}`,
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

    const participants = joinTagArray(metadata.participants)
    if (participants) result.participants = participants

    if (metadata.duration != null) {
      const num = Number(metadata.duration)
      if (!Number.isNaN(num)) result.duration = num
    }

    const meetingDate = parseTagDate(metadata.meetingDate)
    if (meetingDate) result.meetingDate = meetingDate

    return result
  },
}
