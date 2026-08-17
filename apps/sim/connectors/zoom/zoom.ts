import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  CONNECTOR_MAX_FILE_BYTES,
  isSkippedDocument,
  markSkipped,
  parseTagDate,
  readBodyWithLimit,
  sizeLimitSkipReason,
  stubOrSkipBySize,
  takeIndexableWithinCap,
} from '@/connectors/utils'
import { zoomConnectorMeta } from '@/connectors/zoom/meta'

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

/**
 * Formats a date as `yyyy-mm-dd` in UTC. Zoom documents `from`/`to` on the
 * recordings listing as UTC dates, so local-timezone getters would shift the
 * window boundary by a day on any non-UTC host.
 */
function formatDate(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * True when `url` is an https URL on a Zoom-owned host. `download_url` is taken
 * verbatim from an API response and is fetched with the user's access token in
 * the Authorization header, so the host is checked before the token is attached.
 */
function isZoomDownloadUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'zoom.us' || parsed.hostname.endsWith('.zoom.us'))
    )
  } catch {
    return false
  }
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
      fileSize: transcriptFile.file_size,
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
  ...zoomConnectorMeta,

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

    /**
     * Zoom caps the `from`/`to` range at one month and both bounds are inclusive,
     * so each window spans exactly `WINDOW_DAYS` calendar days (`to - (WINDOW_DAYS - 1)`).
     * Consecutive windows abut without overlapping, which keeps every request
     * inside the documented range and stops the seam day being listed twice.
     */
    const now = new Date()
    const earliest = new Date(now.getTime() - lookbackDays * MS_PER_DAY)
    const toDate = new Date(now.getTime() - state.windowIndex * WINDOW_DAYS * MS_PER_DAY)
    const rawFromDate = new Date(toDate.getTime() - (WINDOW_DAYS - 1) * MS_PER_DAY)
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
      allDocuments.push(
        stubOrSkipBySize(
          recordingToStub(meeting, transcript),
          transcript.file_size,
          CONNECTOR_MAX_FILE_BYTES
        )
      )
    }

    const prevFetched = (syncContext?.totalDocsFetched as number) ?? 0
    const { documents, indexableCount, capReached } = takeIndexableWithinCap(
      allDocuments,
      isSkippedDocument,
      maxRecordings,
      prevFetched
    )

    const totalFetched = prevFetched + indexableCount
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = capReached

    /**
     * `capReached` alone is not truncation. It is also true when the cap lands exactly on
     * the last recording of the last window, where nothing was withheld — and
     * `takeIndexableWithinCap` cannot distinguish the two, because it reports only that
     * the budget ran out, not whether it stopped mid-page. Setting `listingCapped` there
     * would suppress deletion reconciliation on every subsequent sync of a source that
     * simply sits at its cap, so purged recordings would never leave the knowledge base.
     *
     * The listing is capped only when the cap actually withheld something: recordings
     * dropped from this page, or a page/window left unread behind it.
     */
    const droppedFromPage = documents.length < allDocuments.length
    const moreBehindCap = Boolean(nextPageToken) || state.windowIndex + 1 < numWindows
    if (hitLimit && (droppedFromPage || moreBehindCap) && syncContext) {
      syncContext.listingCapped = true
    }

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
    if (!externalId) return null

    const url = `${ZOOM_API_BASE}/meetings/${encodeMeetingUuid(externalId)}/recordings`

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    })

    /**
     * Only a deleted recording (404/410) resolves to `null`. Every other failure
     * throws so the sync engine records a visible failed document instead of
     * dropping the recording from the run with no counter and no error log.
     */
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

    if (!isZoomDownloadUrl(transcript.download_url)) {
      throw new Error('Refusing to send the Zoom access token to a non-Zoom download host')
    }

    /**
     * The access token goes in the Authorization header, never in the URL: Zoom
     * removed support for token values in query parameters in February 2023 and
     * answers `?access_token=` with `Invalid access token, this access token is
     * not supported as a query parameter string`.
     */
    const vttResponse = await fetchWithRetry(transcript.download_url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    /**
     * A transcript the API just advertised is expected to download. A 404/410 means
     * it was purged between the two calls; anything else is a fault and must fail
     * the document rather than silently drop it.
     */
    if (!vttResponse.ok) {
      if (vttResponse.status === 404 || vttResponse.status === 410) {
        logger.info('Zoom transcript was purged before it could be downloaded', { externalId })
        return null
      }
      throw new Error(`Failed to download Zoom transcript: ${vttResponse.status}`)
    }

    const vttBuffer = await readBodyWithLimit(vttResponse, CONNECTOR_MAX_FILE_BYTES)
    if (!vttBuffer) {
      return markSkipped(
        recordingToStub(recording, transcript),
        sizeLimitSkipReason(CONNECTOR_MAX_FILE_BYTES)
      )
    }

    const vttText = vttBuffer.toString('utf8')
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
        fileSize: transcript.file_size,
      },
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

    /**
     * Lists a single day with `page_size=1` — the cheapest call that exercises
     * the cloud-recording listing scope the sync actually depends on. `/users/me`
     * would only prove the token is live, not that recordings are readable.
     */
    const today = formatDate(new Date())
    const probe = new URLSearchParams({ page_size: '1', from: today, to: today })

    try {
      const response = await fetchWithRetry(
        `${ZOOM_API_BASE}/users/me/recordings?${probe.toString()}`,
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
