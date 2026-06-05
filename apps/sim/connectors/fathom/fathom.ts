import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { FathomIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseTagDate } from '@/connectors/utils'

const logger = createLogger('FathomConnector')

const FATHOM_API_BASE = 'https://api.fathom.ai/external/v1'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Days subtracted from `lastSyncAt` when computing the incremental `created_after`
 * window. Fathom's list endpoint only filters by creation time (no update-based
 * filter), so a meeting whose transcript was not yet ready on the sync that first
 * saw it would otherwise never be re-listed. The overlap keeps recently-created
 * meetings in the window long enough for late transcripts to be retried — the sync
 * engine re-attempts meetings whose `getDocument` previously returned null, since
 * those are never persisted. Matches the Gong connector's overlap approach.
 */
const INCREMENTAL_OVERLAP_DAYS = 14

/**
 * Fathom authenticates external API requests with the `X-Api-Key` header.
 * (The API also accepts `Authorization: Bearer` for OAuth-connected apps, but
 * the api-key flow this connector uses requires `X-Api-Key`.)
 */
function buildHeaders(apiKey: string): Record<string, string> {
  return {
    'X-Api-Key': apiKey,
    'Content-Type': 'application/json',
  }
}

/**
 * A meeting object as returned by `GET /meetings`. Only the fields this
 * connector reads are typed; the API returns additional fields.
 */
interface FathomMeeting {
  recording_id?: number
  title?: string
  meeting_title?: string | null
  url?: string
  share_url?: string
  created_at?: string
  scheduled_start_time?: string | null
  scheduled_end_time?: string | null
  recording_start_time?: string | null
  recording_end_time?: string | null
  transcript_language?: string
  calendar_invitees_domains_type?: 'only_internal' | 'one_or_more_external' | null
  recorded_by?: {
    name?: string
    email?: string
    email_domain?: string
    team?: string | null
  } | null
}

interface FathomMeetingsListResponse {
  items?: FathomMeeting[]
  next_cursor?: string | null
}

/**
 * A single transcript entry as returned by `GET /recordings/{id}/transcript`.
 */
interface FathomTranscriptEntry {
  speaker?: {
    display_name?: string
    matched_calendar_invitee_email?: string | null
  }
  text?: string
  timestamp?: string
}

interface FathomTranscriptResponse {
  transcript?: FathomTranscriptEntry[]
}

interface FathomSummary {
  template_name?: string | null
  markdown_formatted?: string | null
}

interface FathomSummaryResponse {
  summary?: FathomSummary | null
}

/**
 * Header fields cached per recording during `listDocuments` so `getDocument`
 * can render an identical document header. Fathom exposes no single-meeting
 * GET and no `recording_ids` filter, so this metadata cannot be refetched once
 * listing has moved past the page that contained it — it is carried forward in
 * the shared `syncContext` instead.
 */
interface FathomMeetingHeader {
  title: string
  meetingDate?: string
  durationSeconds?: number
  recordedByEmail?: string
  recordedByName?: string
  team?: string
  sourceUrl?: string
  contentHash: string
  metadata: FathomMeetingMetadata
}

/**
 * Metadata describing a Fathom meeting, attached to the listing stub. The sync
 * engine merges this onto the hydrated document, so `getDocument` never needs
 * to reproduce it.
 */
interface FathomMeetingMetadata {
  recordingId?: string
  recordedByEmail?: string
  recordedByName?: string
  team?: string
  meetingType?: string
  meetingDate?: string
  durationSeconds?: number
  transcriptLanguage?: string
  title?: string
}

/**
 * Maps Fathom's `calendar_invitees_domains_type` to a human-readable meeting
 * type. This is the only meeting-type signal the API exposes: `only_internal`
 * means every invitee shares the recorder's domain; `one_or_more_external`
 * means at least one external attendee (customer-facing).
 */
function resolveMeetingType(meeting: FathomMeeting): string | undefined {
  switch (meeting.calendar_invitees_domains_type) {
    case 'only_internal':
      return 'internal'
    case 'one_or_more_external':
      return 'external'
    default:
      return undefined
  }
}

/**
 * Computes the meeting duration in whole seconds from the recording window,
 * or undefined when either bound is missing or unparseable.
 */
function computeDurationSeconds(meeting: FathomMeeting): number | undefined {
  const start = meeting.recording_start_time ?? meeting.scheduled_start_time ?? undefined
  const end = meeting.recording_end_time ?? meeting.scheduled_end_time ?? undefined
  if (!start || !end) return undefined
  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return undefined
  return Math.round((endMs - startMs) / 1000)
}

/**
 * Returns the best title for a meeting, falling back through the title fields.
 */
function resolveTitle(meeting: FathomMeeting): string {
  const title = meeting.title?.trim() || meeting.meeting_title?.trim()
  return title || 'Untitled Fathom Meeting'
}

/**
 * Extracts the connector metadata bag attached to a listing stub.
 */
function buildMetadata(meeting: FathomMeeting): FathomMeetingMetadata {
  return {
    recordingId: meeting.recording_id != null ? String(meeting.recording_id) : undefined,
    recordedByEmail: meeting.recorded_by?.email,
    recordedByName: meeting.recorded_by?.name,
    team: meeting.recorded_by?.team ?? undefined,
    meetingType: resolveMeetingType(meeting),
    meetingDate: meeting.recording_start_time ?? meeting.created_at ?? undefined,
    durationSeconds: computeDurationSeconds(meeting),
    transcriptLanguage: meeting.transcript_language,
    title: resolveTitle(meeting),
  }
}

/**
 * Extracts the lightweight header fields cached for `getDocument`.
 */
function buildHeader(meeting: FathomMeeting): FathomMeetingHeader {
  return {
    title: resolveTitle(meeting),
    meetingDate: meeting.recording_start_time ?? meeting.created_at ?? undefined,
    durationSeconds: computeDurationSeconds(meeting),
    recordedByEmail: meeting.recorded_by?.email,
    recordedByName: meeting.recorded_by?.name,
    team: meeting.recorded_by?.team ?? undefined,
    sourceUrl: buildSourceUrl(meeting),
    contentHash: buildContentHash(meeting),
    metadata: buildMetadata(meeting),
  }
}

/**
 * Builds a metadata-based content hash. Fathom recordings are immutable once
 * processed, so the recording id plus its end/creation timestamps fully identify
 * a version. The same value is cached in the header and returned by `getDocument`,
 * so the stub and hydrated document hash identically.
 */
function buildContentHash(meeting: FathomMeeting): string {
  return `fathom:${meeting.recording_id ?? ''}:${meeting.recording_end_time ?? ''}:${meeting.created_at ?? ''}`
}

function buildSourceUrl(meeting: FathomMeeting): string | undefined {
  return meeting.share_url || meeting.url || undefined
}

/**
 * Reads the cached header for a recording out of the shared sync context.
 */
function readCachedHeader(
  syncContext: Record<string, unknown> | undefined,
  recordingId: string
): FathomMeetingHeader | undefined {
  const cache = syncContext?.meetingHeaders as Record<string, FathomMeetingHeader> | undefined
  return cache?.[recordingId]
}

/**
 * Stores the header for a recording in the shared sync context.
 */
function cacheHeader(
  syncContext: Record<string, unknown> | undefined,
  recordingId: string,
  header: FathomMeetingHeader
): void {
  if (!syncContext) return
  const cache =
    (syncContext.meetingHeaders as Record<string, FathomMeetingHeader> | undefined) ?? {}
  cache[recordingId] = header
  syncContext.meetingHeaders = cache
}

/**
 * Formats the meeting header, optional summary, and transcript into a single
 * plain-text document with one `Speaker: text` line per transcript entry.
 */
function formatMeetingContent(
  header: FathomMeetingHeader | undefined,
  transcript: FathomTranscriptEntry[],
  summary: FathomSummary | null
): string {
  const parts: string[] = []

  parts.push(`Meeting: ${header?.title ?? 'Untitled Fathom Meeting'}`)

  if (header?.meetingDate) parts.push(`Date: ${header.meetingDate}`)

  if (header?.durationSeconds != null) {
    parts.push(`Duration: ${Math.round(header.durationSeconds / 60)} minutes`)
  }

  if (header?.recordedByEmail) {
    parts.push(`Recorded by: ${header.recordedByName ?? header.recordedByEmail}`)
  }

  if (header?.team) parts.push(`Team: ${header.team}`)

  if (summary?.markdown_formatted?.trim()) {
    parts.push('')
    parts.push('--- Summary ---')
    parts.push(summary.markdown_formatted.trim())
  }

  if (transcript.length > 0) {
    parts.push('')
    parts.push('--- Transcript ---')
    for (const entry of transcript) {
      const speaker = entry.speaker?.display_name?.trim() || 'Unknown'
      const text = entry.text?.trim()
      if (text) parts.push(`${speaker}: ${text}`)
    }
  }

  return parts.join('\n')
}

/**
 * Converts a listing meeting into a deferred stub. Content is fetched lazily
 * via `getDocument` only for new or changed meetings.
 */
function meetingToStub(meeting: FathomMeeting): ExternalDocument {
  const metadata = buildMetadata(meeting)
  return {
    externalId: String(meeting.recording_id),
    title: resolveTitle(meeting),
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: buildSourceUrl(meeting),
    contentHash: buildContentHash(meeting),
    metadata: { ...metadata },
  }
}

export const fathomConnector: ConnectorConfig = {
  id: 'fathom',
  name: 'Fathom',
  description: 'Sync meeting transcripts and summaries from Fathom',
  version: '1.0.0',
  icon: FathomIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your Fathom API key',
  },

  supportsIncrementalSync: true,

  configFields: [
    {
      id: 'recordedBy',
      title: 'Filter by Recorder Email',
      type: 'short-input',
      placeholder: 'e.g. john@example.com',
      required: false,
      description: 'Only sync meetings recorded by this email',
    },
    {
      id: 'teams',
      title: 'Filter by Team',
      type: 'short-input',
      placeholder: 'e.g. Sales',
      required: false,
      description: 'Only sync meetings belonging to this team',
    },
    {
      id: 'meetingType',
      title: 'Filter by Meeting Type',
      type: 'dropdown',
      mode: 'advanced',
      required: false,
      description:
        'Only sync internal meetings (everyone shares the recorder’s domain) or external meetings (at least one outside attendee). Leave as All to sync both.',
      options: [
        { id: 'all', label: 'All meetings' },
        { id: 'one_or_more_external', label: 'External (customer-facing) only' },
        { id: 'only_internal', label: 'Internal only' },
      ],
    },
    {
      id: 'inviteeDomains',
      title: 'Filter by Attendee Domain',
      type: 'short-input',
      mode: 'advanced',
      placeholder: 'e.g. acme.com',
      required: false,
      description:
        'Only sync meetings that include a calendar invitee from this company email domain (exact match).',
    },
    {
      id: 'maxMeetings',
      title: 'Max Meetings',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 200 (default: unlimited)',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>,
    lastSyncAt?: Date
  ): Promise<ExternalDocumentList> => {
    const recordedBy = (sourceConfig.recordedBy as string | undefined)?.trim()
    const teams = (sourceConfig.teams as string | undefined)?.trim()
    const meetingType = (sourceConfig.meetingType as string | undefined)?.trim()
    const inviteeDomain = (sourceConfig.inviteeDomains as string | undefined)?.trim()
    const maxMeetings = sourceConfig.maxMeetings ? Number(sourceConfig.maxMeetings) : 0

    const url = new URL(`${FATHOM_API_BASE}/meetings`)
    if (recordedBy) url.searchParams.append('recorded_by[]', recordedBy)
    if (teams) url.searchParams.append('teams[]', teams)
    if (meetingType && meetingType !== 'all') {
      url.searchParams.append('calendar_invitees_domains_type', meetingType)
    }
    if (inviteeDomain) url.searchParams.append('calendar_invitees_domains[]', inviteeDomain)
    if (cursor) url.searchParams.append('cursor', cursor)
    if (lastSyncAt) {
      const createdAfter = new Date(lastSyncAt.getTime() - INCREMENTAL_OVERLAP_DAYS * MS_PER_DAY)
      url.searchParams.append('created_after', createdAfter.toISOString())
    }

    logger.info('Listing Fathom meetings', {
      hasCursor: Boolean(cursor),
      recordedBy,
      teams,
      meetingType,
      inviteeDomain,
      incremental: Boolean(lastSyncAt),
    })

    const response = await fetchWithRetry(url.toString(), {
      method: 'GET',
      headers: buildHeaders(accessToken),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error('Failed to list Fathom meetings', {
        status: response.status,
        error: errorText.slice(0, 500),
      })
      throw new Error(`Failed to list Fathom meetings: ${response.status}`)
    }

    const data = (await response.json()) as FathomMeetingsListResponse
    const meetings = data.items ?? []
    const nextCursor = data.next_cursor?.trim() || undefined

    const allDocuments: ExternalDocument[] = []
    for (const meeting of meetings) {
      if (meeting.recording_id == null) continue
      const externalId = String(meeting.recording_id)
      cacheHeader(syncContext, externalId, buildHeader(meeting))
      allDocuments.push(meetingToStub(meeting))
    }

    const prevFetched = (syncContext?.totalDocsFetched as number) ?? 0
    let documents = allDocuments
    if (maxMeetings > 0) {
      const remaining = Math.max(0, maxMeetings - prevFetched)
      if (allDocuments.length > remaining) {
        documents = allDocuments.slice(0, remaining)
      }
    }

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = maxMeetings > 0 && totalFetched >= maxMeetings
    if (hitLimit && syncContext) syncContext.listingCapped = true

    const hasMore = !hitLimit && Boolean(nextCursor)

    return {
      documents,
      nextCursor: hasMore ? nextCursor : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    try {
      if (!externalId) return null

      const transcriptUrl = `${FATHOM_API_BASE}/recordings/${encodeURIComponent(externalId)}/transcript`
      const transcriptResponse = await fetchWithRetry(transcriptUrl, {
        method: 'GET',
        headers: buildHeaders(accessToken),
      })

      if (!transcriptResponse.ok) {
        if (transcriptResponse.status === 404) return null
        throw new Error(`Failed to fetch Fathom transcript: ${transcriptResponse.status}`)
      }

      const transcriptData = (await transcriptResponse.json()) as FathomTranscriptResponse
      const transcript = transcriptData.transcript ?? []

      let summary: FathomSummary | null = null
      try {
        const summaryUrl = `${FATHOM_API_BASE}/recordings/${encodeURIComponent(externalId)}/summary`
        const summaryResponse = await fetchWithRetry(summaryUrl, {
          method: 'GET',
          headers: buildHeaders(accessToken),
        })
        if (summaryResponse.ok) {
          const summaryData = (await summaryResponse.json()) as FathomSummaryResponse
          summary = summaryData.summary ?? null
        }
      } catch (summaryError) {
        logger.warn('Failed to fetch Fathom summary', {
          externalId,
          error: toError(summaryError).message,
        })
      }

      const hasTranscript = transcript.some((entry) => entry.text?.trim())
      const hasSummary = Boolean(summary?.markdown_formatted?.trim())
      if (!hasTranscript && !hasSummary) {
        logger.info('No transcript or summary yet for Fathom meeting', { externalId })
        return null
      }

      const header = readCachedHeader(syncContext, externalId)
      if (!header) {
        logger.warn(
          'No cached header for Fathom meeting; skipping to avoid an un-refreshable record',
          {
            externalId,
          }
        )
        return null
      }

      const content = formatMeetingContent(header, transcript, summary).trim()
      if (!content) return null

      return {
        externalId,
        title: header.title,
        content,
        contentDeferred: false,
        mimeType: 'text/plain',
        sourceUrl: header.sourceUrl,
        contentHash: header.contentHash,
        metadata: { ...header.metadata },
      }
    } catch (error) {
      logger.warn('Failed to get Fathom meeting', {
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

    try {
      const response = await fetchWithRetry(
        `${FATHOM_API_BASE}/meetings`,
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
          error: `Fathom access failed: ${response.status}${errorText ? ` — ${errorText.slice(0, 200)}` : ''}`,
        }
      }

      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'title', displayName: 'Title', fieldType: 'text' },
    { id: 'recordedByEmail', displayName: 'Recorded By (Email)', fieldType: 'text' },
    { id: 'recordedByName', displayName: 'Recorded By (Name)', fieldType: 'text' },
    { id: 'team', displayName: 'Team', fieldType: 'text' },
    { id: 'meetingType', displayName: 'Meeting Type', fieldType: 'text' },
    { id: 'transcriptLanguage', displayName: 'Language', fieldType: 'text' },
    { id: 'durationSeconds', displayName: 'Duration (seconds)', fieldType: 'number' },
    { id: 'meetingDate', displayName: 'Meeting Date', fieldType: 'date' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.title === 'string' && metadata.title.trim()) {
      result.title = metadata.title
    }

    if (typeof metadata.recordedByEmail === 'string' && metadata.recordedByEmail.trim()) {
      result.recordedByEmail = metadata.recordedByEmail
    }

    if (typeof metadata.recordedByName === 'string' && metadata.recordedByName.trim()) {
      result.recordedByName = metadata.recordedByName
    }

    if (typeof metadata.team === 'string' && metadata.team.trim()) {
      result.team = metadata.team
    }

    if (typeof metadata.meetingType === 'string' && metadata.meetingType.trim()) {
      result.meetingType = metadata.meetingType
    }

    if (typeof metadata.transcriptLanguage === 'string' && metadata.transcriptLanguage.trim()) {
      result.transcriptLanguage = metadata.transcriptLanguage
    }

    if (metadata.durationSeconds != null) {
      const num = Number(metadata.durationSeconds)
      if (!Number.isNaN(num)) result.durationSeconds = num
    }

    const meetingDate = parseTagDate(metadata.meetingDate)
    if (meetingDate) result.meetingDate = meetingDate

    return result
  },
}
