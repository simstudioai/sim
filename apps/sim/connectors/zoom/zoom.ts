import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { ZoomIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseTagDate } from '@/connectors/utils'

const logger = createLogger('ZoomConnector')

const ZOOM_API_BASE = 'https://api.zoom.us/v2'
const PAGE_SIZE = 300
const WINDOW_DAYS = 30
const DEFAULT_LOOKBACK_DAYS = 180
const MAX_LOOKBACK_DAYS = 180
/**
 * Days of overlap added when computing the incremental sync window. Zoom transcript
 * generation is usually fast, but AI Companion / audio transcription can lag hours to
 * days for large accounts. A 30-day overlap catches late-arriving transcripts at the
 * cost of at most one extra 30-day window per sync.
 */
const INCREMENTAL_OVERLAP_DAYS = 30
const MS_PER_DAY = 24 * 60 * 60 * 1000

interface ZoomRecordingFile {
  id?: string
  meeting_id?: string
  recording_start?: string
  recording_end?: string
  file_type?: string
  file_extension?: string
  file_size?: number
  download_url?: string
  status?: string
  recording_type?: string
}

interface ZoomRecording {
  uuid: string
  id?: number | string
  topic?: string
  start_time?: string
  duration?: number
  total_size?: number
  recording_count?: number
  share_url?: string
  host_email?: string
  host_id?: string
  account_id?: string
  type?: number
  recording_files?: ZoomRecordingFile[]
}

interface ZoomRecordingsListResponse {
  meetings?: ZoomRecording[]
  next_page_token?: string
  page_size?: number
  total_records?: number
  from?: string
  to?: string
}

interface CursorState {
  windowIndex: number
  pageToken?: string
}

/**
 * URL-encodes a Zoom meeting UUID. Double-encodes when the UUID starts with '/'
 * or contains '//', per Zoom's API requirements.
 */
function encodeMeetingUuid(uuid: string): string {
  const encoded = encodeURIComponent(uuid)
  if (uuid.startsWith('/') || uuid.includes('//')) {
    return encodeURIComponent(encoded)
  }
  return encoded
}

function formatDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function encodeCursor(state: CursorState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
}

function decodeCursor(cursor?: string): CursorState {
  if (!cursor) return { windowIndex: 0 }
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf8')
    const parsed = JSON.parse(json) as Partial<CursorState>
    return {
      windowIndex: Number(parsed.windowIndex) || 0,
      pageToken: typeof parsed.pageToken === 'string' ? parsed.pageToken : undefined,
    }
  } catch {
    return { windowIndex: 0 }
  }
}

/**
 * Picks the best transcript file from a recording's files array.
 * Prefers the AI Companion audio_transcript (file_type TRANSCRIPT) and falls back
 * to closed captions (file_type CC) — both are VTT and contain spoken text.
 */
function findTranscriptFile(files?: ZoomRecordingFile[]): ZoomRecordingFile | undefined {
  if (!files) return undefined
  const eligible = (f: ZoomRecordingFile) =>
    Boolean(f.download_url) && (f.status === 'completed' || f.status == null)

  const transcript = files.find((f) => f.file_type === 'TRANSCRIPT' && eligible(f))
  if (transcript) return transcript
  return files.find((f) => f.file_type === 'CC' && eligible(f))
}

/**
 * Extracts spoken text from a Zoom WebVTT transcript, stripping cue identifiers,
 * timestamps, and inline markup. Handles both Zoom's `Speaker: text` convention
 * and standard WebVTT `<v Speaker>text</v>` voice tags.
 *
 * Exported for unit tests; not part of the connector's public surface.
 */
export function parseVtt(vtt: string): string {
  const lines = vtt.split(/\r?\n/)
  const segments: string[] = []
  let i = 0

  while (i < lines.length && lines[i].trim() !== '') i++

  while (i < lines.length) {
    while (i < lines.length && lines[i].trim() === '') i++
    if (i >= lines.length) break

    if (i + 1 < lines.length && !lines[i].includes('-->') && lines[i + 1].includes('-->')) {
      i++
    }

    if (i < lines.length && lines[i].includes('-->')) {
      i++
    } else {
      while (i < lines.length && lines[i].trim() !== '') i++
      continue
    }

    const textParts: string[] = []
    while (i < lines.length && lines[i].trim() !== '') {
      textParts.push(lines[i])
      i++
    }

    if (textParts.length > 0) {
      const raw = textParts.join(' ')
      const withSpeakers = raw.replace(/<v(?:\.[^\s>]+)?\s+([^>]+)>([\s\S]*?)<\/v>/g, '$1: $2')
      let withoutTags = withSpeakers
      let previous: string
      do {
        previous = withoutTags
        withoutTags = withoutTags.replace(/<\/?[^>]+>/g, '')
      } while (withoutTags !== previous)
      const stripped = withoutTags.replace(/\s+/g, ' ').trim()
      if (stripped) segments.push(stripped)
    }
  }

  return segments.join('\n')
}

function formatTranscriptContent(recording: ZoomRecording, transcript: string): string {
  const parts: string[] = []
  if (recording.topic) parts.push(`Meeting: ${recording.topic}`)
  if (recording.start_time) parts.push(`Date: ${recording.start_time}`)
  if (recording.duration != null) parts.push(`Duration: ${recording.duration} minutes`)
  if (recording.host_email) parts.push(`Host: ${recording.host_email}`)

  parts.push('')
  parts.push('--- Transcript ---')
  parts.push(transcript)

  return parts.join('\n')
}

function buildContentHash(recording: ZoomRecording, file: ZoomRecordingFile): string {
  return `zoom:${recording.uuid}:${file.id ?? ''}:${file.file_size ?? ''}:${file.recording_end ?? ''}`
}

function buildSourceUrl(recording: ZoomRecording): string | undefined {
  return recording.share_url || undefined
}

function recordingToStub(
  recording: ZoomRecording,
  transcriptFile: ZoomRecordingFile
): ExternalDocument {
  return {
    externalId: recording.uuid,
    title: recording.topic?.trim() || 'Untitled Zoom Meeting',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: buildSourceUrl(recording),
    contentHash: buildContentHash(recording, transcriptFile),
    metadata: {
      meetingId: recording.id != null ? String(recording.id) : undefined,
      hostEmail: recording.host_email,
      duration: recording.duration,
      meetingDate: recording.start_time,
      topic: recording.topic,
    },
  }
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

export const zoomConnector: ConnectorConfig = {
  id: 'zoom',
  name: 'Zoom',
  description: 'Sync meeting transcripts from Zoom cloud recordings',
  version: '1.0.0',
  icon: ZoomIcon,

  auth: {
    mode: 'oauth',
    provider: 'zoom',
    requiredScopes: [
      'user:read:user',
      'cloud_recording:read:list_user_recordings',
      'cloud_recording:read:list_recording_files',
    ],
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
        { label: 'Last 90 days', id: '90' },
        { label: 'Last 6 months (recommended)', id: '180' },
      ],
      description:
        'On initial sync only. Zoom only allows access to cloud recordings within the last 6 months.',
    },
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
    syncContext?: Record<string, unknown>,
    lastSyncAt?: Date
  ): Promise<ExternalDocumentList> => {
    const lookbackDays = computeLookbackDays(sourceConfig, lastSyncAt)
    const maxRecordings = sourceConfig.maxRecordings ? Number(sourceConfig.maxRecordings) : 0
    const numWindows = Math.max(1, Math.ceil(lookbackDays / WINDOW_DAYS))
    const state = decodeCursor(cursor)

    if (state.windowIndex >= numWindows) {
      return { documents: [], hasMore: false }
    }

    const now = new Date()
    const earliest = new Date(now.getTime() - lookbackDays * MS_PER_DAY)
    const toDate = new Date(now.getTime() - state.windowIndex * WINDOW_DAYS * MS_PER_DAY)
    const rawFromDate = new Date(toDate.getTime() - WINDOW_DAYS * MS_PER_DAY)
    const fromDate = rawFromDate < earliest ? earliest : rawFromDate

    if (fromDate >= toDate) {
      return { documents: [], hasMore: false }
    }

    const queryParams = new URLSearchParams({
      page_size: String(PAGE_SIZE),
      from: formatDate(fromDate),
      to: formatDate(toDate),
      trash: 'false',
    })
    if (state.pageToken) queryParams.set('next_page_token', state.pageToken)

    const url = `${ZOOM_API_BASE}/users/me/recordings?${queryParams.toString()}`

    logger.info('Listing Zoom recordings', {
      windowIndex: state.windowIndex,
      windowTotal: numWindows,
      from: formatDate(fromDate),
      to: formatDate(toDate),
      hasToken: Boolean(state.pageToken),
      incremental: Boolean(lastSyncAt),
    })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error('Failed to list Zoom recordings', {
        status: response.status,
        error: errorText.slice(0, 500),
      })
      throw new Error(`Failed to list Zoom recordings: ${response.status}`)
    }

    const data = (await response.json()) as ZoomRecordingsListResponse
    const meetings = data.meetings ?? []
    const nextPageToken = data.next_page_token?.trim() || undefined

    const allDocuments: ExternalDocument[] = []
    for (const meeting of meetings) {
      if (!meeting.uuid) continue
      const transcript = findTranscriptFile(meeting.recording_files)
      if (!transcript) continue
      allDocuments.push(recordingToStub(meeting, transcript))
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

    let nextCursor: string | undefined
    let hasMore = false

    if (hitLimit) {
      // Stop syncing — limit reached
    } else if (nextPageToken) {
      nextCursor = encodeCursor({ windowIndex: state.windowIndex, pageToken: nextPageToken })
      hasMore = true
    } else if (state.windowIndex + 1 < numWindows) {
      nextCursor = encodeCursor({ windowIndex: state.windowIndex + 1 })
      hasMore = true
    }

    return { documents, nextCursor, hasMore }
  },

  getDocument: async (
    accessToken: string,
    _sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    try {
      if (!externalId) return null

      const url = `${ZOOM_API_BASE}/meetings/${encodeMeetingUuid(externalId)}/recordings`

      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })

      if (!response.ok) {
        if (response.status === 404 || response.status === 410) return null
        throw new Error(`Failed to fetch Zoom recording: ${response.status}`)
      }

      const recording = (await response.json()) as ZoomRecording
      const transcript = findTranscriptFile(recording.recording_files)

      if (!transcript?.download_url) {
        logger.info('Transcript no longer available for Zoom recording', { externalId })
        return null
      }

      const vttResponse = await fetchWithRetry(transcript.download_url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!vttResponse.ok) {
        logger.warn('Failed to download Zoom transcript', {
          externalId,
          status: vttResponse.status,
        })
        return null
      }

      const vttText = await vttResponse.text()
      const transcriptText = parseVtt(vttText).trim()
      if (!transcriptText) return null

      const content = formatTranscriptContent(recording, transcriptText)

      return {
        externalId: recording.uuid || externalId,
        title: recording.topic?.trim() || 'Untitled Zoom Meeting',
        content,
        contentDeferred: false,
        mimeType: 'text/plain',
        sourceUrl: buildSourceUrl(recording),
        contentHash: buildContentHash(recording, transcript),
        metadata: {
          meetingId: recording.id != null ? String(recording.id) : undefined,
          hostEmail: recording.host_email,
          duration: recording.duration,
          meetingDate: recording.start_time,
          topic: recording.topic,
        },
      }
    } catch (error) {
      logger.warn('Failed to get Zoom recording', {
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
        `${ZOOM_API_BASE}/users/me`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return {
          valid: false,
          error: `Zoom access failed: ${response.status}${errorText ? ` — ${errorText.slice(0, 200)}` : ''}`,
        }
      }

      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'topic', displayName: 'Topic', fieldType: 'text' },
    { id: 'hostEmail', displayName: 'Host Email', fieldType: 'text' },
    { id: 'duration', displayName: 'Duration (minutes)', fieldType: 'number' },
    { id: 'meetingDate', displayName: 'Meeting Date', fieldType: 'date' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.topic === 'string' && metadata.topic.trim()) {
      result.topic = metadata.topic
    }

    if (typeof metadata.hostEmail === 'string' && metadata.hostEmail.trim()) {
      result.hostEmail = metadata.hostEmail
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
