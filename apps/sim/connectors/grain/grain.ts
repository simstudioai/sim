import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { GrainIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { joinTagArray, parseTagDate } from '@/connectors/utils'

const logger = createLogger('GrainConnector')

const GRAIN_API_BASE = 'https://api.grain.com/_/public-api/v2'
/**
 * Grain's Public API requires a pinned date-based version header on every request.
 * Matches the version used by the in-repo Grain tools.
 */
const GRAIN_API_VERSION = '2025-10-31'

/**
 * A participant on a Grain recording. The list endpoint only populates this when
 * `include.participants` is requested in the body.
 */
interface GrainParticipant {
  id: string
  name: string
  email: string | null
}

/**
 * A team a Grain recording belongs to. Always present on the recording object (may be
 * an empty array).
 */
interface GrainTeam {
  id: string
  name: string
}

/**
 * The meeting type classification of a Grain recording. Always present on the recording
 * object but nullable.
 */
interface GrainMeetingType {
  id: string
  name: string
  scope?: 'internal' | 'external'
}

/**
 * A Grain recording as returned by the v2 recordings endpoints. Only the fields the
 * connector reads are modeled; the API returns additional optional fields.
 *
 * The v2 Public API returns the recording identifier as `recording_id` (confirmed in
 * the live list/get response examples). The legacy `id` field is also modeled and used
 * as a defensive fallback by {@link recordingId} so the connector tolerates either shape.
 *
 * `source` and `tags` are always present on the recording object. `teams`,
 * `meeting_type`, and `participants` are populated only when requested via the
 * corresponding `include` flag — the connector requests all three (see
 * {@link RECORDING_INCLUDE}) so they are available for tag mapping.
 */
interface GrainRecording {
  recording_id?: string
  id?: string
  title?: string
  start_datetime?: string
  end_datetime?: string
  duration_ms?: number
  url?: string
  source?: string
  tags?: string[]
  teams?: GrainTeam[]
  meeting_type?: GrainMeetingType | null
  participants?: GrainParticipant[]
}

/**
 * The get-recording endpoint may return the recording bare or wrapped in a `Recording`
 * envelope depending on API version. This models both shapes.
 */
interface GrainRecordingResponse extends GrainRecording {
  Recording?: GrainRecording
}

interface GrainRecordingsListResponse {
  recordings?: GrainRecording[]
  cursor?: string | null
}

/**
 * A single speaker-attributed segment of a Grain transcript. The transcript endpoint
 * returns a bare JSON array of these.
 */
interface GrainTranscriptSegment {
  participant_id: string | null
  speaker?: string
  start?: number
  end?: number
  text?: string
}

/**
 * The `include` flags requested on every recordings call. Grain gates `participants`,
 * `teams`, and `meeting_type` behind include flags; all three feed connector tag
 * mapping, so they are always requested. Requesting an already-default field is a no-op.
 */
const RECORDING_INCLUDE = { participants: true, teams: true, meeting_type: true } as const

/**
 * Builds the auth + version headers shared by every Grain API request.
 */
function grainHeaders(accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
    'Public-Api-Version': GRAIN_API_VERSION,
  }
}

/**
 * Resolves the recording's unique identifier. Prefers the documented v2 field
 * `recording_id`, falling back to the legacy `id` field. Returns an empty string when
 * neither is present.
 */
function recordingId(recording: GrainRecording): string {
  return (recording.recording_id ?? recording.id ?? '').trim()
}

/**
 * Derives the document title for a recording, falling back to a stable placeholder.
 */
function recordingTitle(recording: GrainRecording): string {
  return recording.title?.trim() || 'Untitled Grain Recording'
}

/**
 * Extracts participant display names from a recording, dropping blanks.
 */
function participantNames(recording: GrainRecording): string[] {
  return (recording.participants ?? [])
    .map((p) => p.name?.trim())
    .filter((name): name is string => Boolean(name))
}

/**
 * Extracts team names from a recording, dropping blanks.
 */
function teamNames(recording: GrainRecording): string[] {
  return (recording.teams ?? [])
    .map((t) => t.name?.trim())
    .filter((name): name is string => Boolean(name))
}

/**
 * Extracts user-applied tag labels from a recording, dropping blanks.
 */
function recordingLabels(recording: GrainRecording): string[] {
  return (recording.tags ?? [])
    .map((tag) => tag?.trim())
    .filter((tag): tag is string => Boolean(tag))
}

/**
 * Computes the metadata-based change-detection hash for a recording.
 *
 * Grain exposes no `updated_at`/`modified` field, so the hash combines the stable
 * recording id with `end_datetime` and `duration_ms` — the values that change when a
 * recording is re-processed or re-cut. The identical formula is used for both the
 * listing stub and the fully-fetched document so unchanged recordings are skipped.
 */
function buildContentHash(recording: GrainRecording): string {
  return `grain:${recordingId(recording)}:${recording.end_datetime ?? ''}:${recording.duration_ms ?? ''}`
}

/**
 * Builds the metadata bag attached to both stubs and fetched documents. Keeping a
 * single source ensures the stub and getDocument agree on tag inputs.
 */
function buildMetadata(recording: GrainRecording): Record<string, unknown> {
  return {
    title: recordingTitle(recording),
    duration: recording.duration_ms,
    meetingDate: recording.start_datetime,
    participants: participantNames(recording),
    source: recording.source,
    labels: recordingLabels(recording),
    teams: teamNames(recording),
    meetingType: recording.meeting_type?.name,
  }
}

/**
 * Builds the deferred listing stub for a recording. Content is fetched lazily in
 * getDocument; only metadata and the change hash are computed here.
 */
function recordingToStub(recording: GrainRecording): ExternalDocument {
  return {
    externalId: recordingId(recording),
    title: recordingTitle(recording),
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: recording.url || undefined,
    contentHash: buildContentHash(recording),
    metadata: buildMetadata(recording),
  }
}

/**
 * Formats a recording header plus speaker-attributed transcript lines into plain text.
 */
function formatTranscriptContent(
  recording: GrainRecording,
  segments: GrainTranscriptSegment[]
): string {
  const parts: string[] = []

  parts.push(`Meeting: ${recordingTitle(recording)}`)
  if (recording.start_datetime) parts.push(`Date: ${recording.start_datetime}`)
  if (recording.duration_ms != null) {
    const minutes = Math.round(recording.duration_ms / 60000)
    parts.push(`Duration: ${minutes} minutes`)
  }
  const names = participantNames(recording)
  if (names.length > 0) parts.push(`Participants: ${names.join(', ')}`)

  parts.push('')
  parts.push('--- Transcript ---')
  for (const segment of segments) {
    const text = segment.text?.trim()
    if (!text) continue
    const speaker = segment.speaker?.trim() || 'Unknown'
    parts.push(`${speaker}: ${text}`)
  }

  return parts.join('\n')
}

/**
 * Fetches a single recording's metadata from the v2 recordings endpoint.
 * Returns null on 404 (recording deleted/inaccessible).
 */
async function fetchRecording(accessToken: string, id: string): Promise<GrainRecording | null> {
  const response = await fetchWithRetry(`${GRAIN_API_BASE}/recordings/${id}`, {
    method: 'POST',
    headers: grainHeaders(accessToken),
    body: JSON.stringify({ include: RECORDING_INCLUDE }),
  })

  if (!response.ok) {
    if (response.status === 404) return null
    throw new Error(`Failed to fetch Grain recording: ${response.status}`)
  }

  const data = (await response.json()) as GrainRecordingResponse
  return data.Recording ?? data
}

/**
 * Fetches the speaker-attributed transcript segments for a recording.
 * Returns null on 404, or an empty array when the recording has no transcript yet.
 */
async function fetchTranscript(
  accessToken: string,
  id: string
): Promise<GrainTranscriptSegment[] | null> {
  const response = await fetchWithRetry(`${GRAIN_API_BASE}/recordings/${id}/transcript`, {
    method: 'GET',
    headers: grainHeaders(accessToken),
  })

  if (!response.ok) {
    if (response.status === 404) return null
    throw new Error(`Failed to fetch Grain transcript: ${response.status}`)
  }

  const data = await response.json()
  return Array.isArray(data) ? (data as GrainTranscriptSegment[]) : []
}

export const grainConnector: ConnectorConfig = {
  id: 'grain',
  name: 'Grain',
  description: 'Sync meeting recording transcripts from Grain',
  version: '1.0.0',
  icon: GrainIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your Grain API key',
  },

  configFields: [
    {
      id: 'maxRecordings',
      title: 'Max Recordings',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 200 (default: unlimited)',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const maxRecordings = sourceConfig.maxRecordings ? Number(sourceConfig.maxRecordings) : 0

    const body: Record<string, unknown> = { include: RECORDING_INCLUDE }
    if (cursor) body.cursor = cursor

    logger.info('Listing Grain recordings', { hasCursor: Boolean(cursor) })

    const response = await fetchWithRetry(`${GRAIN_API_BASE}/recordings`, {
      method: 'POST',
      headers: grainHeaders(accessToken),
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error('Failed to list Grain recordings', {
        status: response.status,
        error: errorText.slice(0, 500),
      })
      throw new Error(`Failed to list Grain recordings: ${response.status}`)
    }

    const data = (await response.json()) as GrainRecordingsListResponse
    const recordings = data.recordings ?? []
    const nextCursor = data.cursor?.trim() || undefined

    const allDocuments: ExternalDocument[] = []
    for (const recording of recordings) {
      if (!recordingId(recording)) continue
      allDocuments.push(recordingToStub(recording))
    }

    const prevFetched = (syncContext?.totalDocsFetched as number) ?? 0
    let documents = allDocuments
    if (maxRecordings > 0) {
      const remaining = Math.max(0, maxRecordings - prevFetched)
      if (allDocuments.length > remaining) {
        documents = allDocuments.slice(0, remaining)
      }
    }

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = maxRecordings > 0 && totalFetched >= maxRecordings
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
    externalId: string
  ): Promise<ExternalDocument | null> => {
    try {
      if (!externalId) return null

      const recording = await fetchRecording(accessToken, externalId)
      if (!recording) return null

      const segments = await fetchTranscript(accessToken, externalId)
      if (!segments) return null

      const content = formatTranscriptContent(recording, segments)
      const hasTranscript = segments.some((segment) => segment.text?.trim())
      if (!hasTranscript) {
        logger.info('Transcript not yet available for Grain recording', { externalId })
        return null
      }

      return {
        externalId,
        title: recordingTitle(recording),
        content,
        contentDeferred: false,
        mimeType: 'text/plain',
        sourceUrl: recording.url || undefined,
        contentHash: buildContentHash(recording),
        metadata: buildMetadata(recording),
      }
    } catch (error) {
      logger.warn('Failed to get Grain recording', {
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
    const maxRecordings = sourceConfig.maxRecordings as string | undefined
    if (maxRecordings && (Number.isNaN(Number(maxRecordings)) || Number(maxRecordings) < 0)) {
      return { valid: false, error: 'Max recordings must be a non-negative number' }
    }

    try {
      const response = await fetchWithRetry(
        `${GRAIN_API_BASE}/recordings`,
        {
          method: 'POST',
          headers: grainHeaders(accessToken),
          body: JSON.stringify({}),
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return {
          valid: false,
          error: `Grain access failed: ${response.status}${errorText ? ` — ${errorText.slice(0, 200)}` : ''}`,
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
    { id: 'participants', displayName: 'Participants', fieldType: 'text' },
    { id: 'source', displayName: 'Source', fieldType: 'text' },
    { id: 'labels', displayName: 'Labels', fieldType: 'text' },
    { id: 'teams', displayName: 'Teams', fieldType: 'text' },
    { id: 'meetingType', displayName: 'Meeting Type', fieldType: 'text' },
    { id: 'duration', displayName: 'Duration (ms)', fieldType: 'number' },
    { id: 'meetingDate', displayName: 'Meeting Date', fieldType: 'date' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.title === 'string' && metadata.title.trim()) {
      result.title = metadata.title
    }

    const participants = joinTagArray(metadata.participants)
    if (participants) result.participants = participants

    if (typeof metadata.source === 'string' && metadata.source.trim()) {
      result.source = metadata.source.trim()
    }

    const labels = joinTagArray(metadata.labels)
    if (labels) result.labels = labels

    const teams = joinTagArray(metadata.teams)
    if (teams) result.teams = teams

    if (typeof metadata.meetingType === 'string' && metadata.meetingType.trim()) {
      result.meetingType = metadata.meetingType.trim()
    }

    if (metadata.duration != null) {
      const num = Number(metadata.duration)
      if (!Number.isNaN(num)) result.duration = num
    }

    const meetingDate = parseTagDate(metadata.meetingDate)
    if (meetingDate) result.meetingDate = meetingDate

    return result
  },
}
