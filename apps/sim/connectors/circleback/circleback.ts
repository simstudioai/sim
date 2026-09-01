import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { circlebackConnectorMeta } from '@/connectors/circleback/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { joinTagArray, parseTagDate } from '@/connectors/utils'

const logger = createLogger('CirclebackConnector')

const CIRCLEBACK_API_BASE = 'https://circleback.ai/api'

const OWNERSHIP_VALUES = new Set(['All', 'Mine', 'Shared'])

/**
 * A meeting attendee as returned by the Circleback API.
 */
interface CirclebackAttendee {
  profileId?: number
  name?: string | null
  email?: string | null
}

/**
 * An action item embedded in a meeting payload.
 */
interface CirclebackActionItem {
  title?: string
  description?: string
  assignee?: { name?: string | null; email?: string | null } | null
  status?: string
}

/**
 * A tag on a meeting.
 */
interface CirclebackTag {
  id?: number
  name?: string
}

/**
 * The meeting shape returned by the list and get endpoints. Both return the
 * same full object, but content assembly is deferred to `getDocument` so
 * listing stays cheap and the optional transcript fetch happens only for
 * new or changed meetings.
 */
interface CirclebackMeeting {
  id?: string
  name?: string | null
  createdAt?: string
  updatedAt?: string
  duration?: number | null
  url?: string | null
  tags?: CirclebackTag[]
  attendees?: CirclebackAttendee[]
  notes?: string | null
  actionItems?: CirclebackActionItem[]
  insights?: Record<string, unknown>
}

/**
 * A transcript segment as returned by the transcript endpoint.
 */
interface CirclebackTranscriptSegment {
  speaker?: string | null
  text?: string
}

/**
 * Builds the authorization headers for a Circleback API request.
 */
function circlebackHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  }
}

/**
 * Extracts the next-page cursor from an RFC 8288 `Link` response header.
 * Circleback list endpoints signal the next page with
 * `Link: <https://circleback.ai/api/...?cursor=abc>; rel="next"`.
 */
function parseNextCursor(response: Response): string | undefined {
  const link = response.headers.get('link')
  if (!link) return undefined
  for (const part of link.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i)
    if (!match) continue
    try {
      return new URL(match[1]).searchParams.get('cursor') ?? undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

/**
 * Produces the change-detection hash for a meeting from its stable identifiers.
 * Circleback exposes `updatedAt`, which advances whenever the meeting changes,
 * so a metadata-only hash is sufficient and stays identical between the list
 * stub and the fetched document — letting the sync engine skip re-fetching
 * unchanged meetings.
 */
function buildContentHash(id: string, updatedAt: string): string {
  return `circleback:${id}:${updatedAt}`
}

/**
 * Parses the optional `maxMeetings` cap from source config.
 * Returns 0 (unlimited) when unset or invalid.
 */
function parseMaxMeetings(sourceConfig: Record<string, unknown>): number {
  const raw = sourceConfig.maxMeetings
  if (raw == null || raw === '') return 0
  const num = Number(raw)
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0
}

/**
 * Parses the optional ownership scope from source config, defaulting to Mine.
 */
function parseOwnership(sourceConfig: Record<string, unknown>): string {
  const raw = sourceConfig.ownership
  return typeof raw === 'string' && OWNERSHIP_VALUES.has(raw) ? raw : 'Mine'
}

/**
 * Parses the optional comma-separated tag ID scope from source config,
 * dropping entries that are not positive integers.
 */
function parseTagIds(sourceConfig: Record<string, unknown>): number[] {
  const raw = sourceConfig.tagIds
  if (typeof raw !== 'string' || !raw.trim()) return []
  return raw
    .split(',')
    .map((entry) => Number(entry.trim()))
    .filter((id) => Number.isInteger(id) && id > 0)
}

/**
 * Whether the transcript should be appended to each document's content.
 */
function shouldIncludeTranscript(sourceConfig: Record<string, unknown>): boolean {
  return String(sourceConfig.includeTranscript) === 'true'
}

/**
 * Collects attendee display names (falling back to email) for tag mapping.
 */
function collectAttendees(meeting: CirclebackMeeting): string[] {
  if (!Array.isArray(meeting.attendees)) return []
  return meeting.attendees
    .map((a) => a.name?.trim() || a.email?.trim() || '')
    .filter((name): name is string => name.length > 0)
}

/**
 * Collects tag names for tag mapping.
 */
function collectTagNames(meeting: CirclebackMeeting): string[] {
  if (!Array.isArray(meeting.tags)) return []
  return meeting.tags
    .map((tag) => tag.name?.trim() || '')
    .filter((name): name is string => name.length > 0)
}

/**
 * Builds the shared metadata payload for a meeting, fed to `mapTags`.
 */
function buildMetadata(meeting: CirclebackMeeting): Record<string, unknown> {
  return {
    title: meeting.name?.trim() || undefined,
    attendees: collectAttendees(meeting),
    tags: collectTagNames(meeting),
    meetingDate: meeting.createdAt,
    duration: meeting.duration ?? undefined,
  }
}

/**
 * Builds the deferred stub for a meeting from list metadata. Content is empty
 * and assembled later via `getDocument` only for new/changed meetings.
 */
function meetingToStub(meeting: CirclebackMeeting): ExternalDocument {
  const id = meeting.id ?? ''
  return {
    externalId: id,
    title: meeting.name?.trim() || 'Untitled Meeting',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `https://circleback.ai/meetings/${encodeURIComponent(id)}`,
    contentHash: buildContentHash(id, meeting.updatedAt ?? ''),
    metadata: buildMetadata(meeting),
  }
}

/**
 * Assembles the document content from a meeting's name, notes, action items,
 * insights, and optionally its transcript. Notes are Markdown and indexed
 * as-is.
 */
function buildContent(
  meeting: CirclebackMeeting,
  transcript: CirclebackTranscriptSegment[] | null
): string {
  const parts: string[] = []

  const title = meeting.name?.trim()
  if (title) parts.push(`# ${title}`)

  const notes = meeting.notes?.trim()
  if (notes) {
    parts.push('')
    parts.push(notes)
  }

  const actionItems = (meeting.actionItems ?? [])
    .map((item) => {
      const itemTitle = item.title?.trim()
      if (!itemTitle) return ''
      const assignee = item.assignee?.name?.trim() || item.assignee?.email?.trim()
      const status = item.status === 'DONE' ? 'x' : ' '
      return `- [${status}] ${itemTitle}${assignee ? ` (${assignee})` : ''}`
    })
    .filter(Boolean)
  if (actionItems.length > 0) {
    parts.push('')
    parts.push('## Action Items')
    parts.push(...actionItems)
  }

  const insights = Object.entries(meeting.insights ?? {})
    .map(([key, value]) => {
      const text = typeof value === 'string' ? value.trim() : ''
      return text ? `### ${key}\n${text}` : ''
    })
    .filter(Boolean)
  if (insights.length > 0) {
    parts.push('')
    parts.push('## Insights')
    parts.push(...insights)
  }

  if (transcript && transcript.length > 0) {
    const lines = transcript
      .map((segment) => {
        const text = segment.text?.trim()
        if (!text) return ''
        const speaker = segment.speaker?.trim()
        return speaker ? `${speaker}: ${text}` : text
      })
      .filter(Boolean)
    if (lines.length > 0) {
      parts.push('')
      parts.push('## Transcript')
      parts.push(...lines)
    }
  }

  return parts.join('\n').trim()
}

export const circlebackConnector: ConnectorConfig = {
  ...circlebackConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const maxMeetings = parseMaxMeetings(sourceConfig)
    const ownership = parseOwnership(sourceConfig)
    const tagIds = parseTagIds(sourceConfig)

    const url = new URL(`${CIRCLEBACK_API_BASE}/meetings`)
    url.searchParams.set('ownership', ownership)
    for (const tagId of tagIds) {
      url.searchParams.append('tagIds', String(tagId))
    }
    if (cursor) url.searchParams.set('cursor', cursor)

    logger.info('Listing Circleback meetings', {
      hasCursor: Boolean(cursor),
      ownership,
      scopedToTags: tagIds.length > 0,
    })

    const response = await fetchWithRetry(url.toString(), {
      method: 'GET',
      headers: circlebackHeaders(accessToken),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error('Failed to list Circleback meetings', {
        status: response.status,
        error: errorText.slice(0, 500),
      })
      throw new Error(`Failed to list Circleback meetings: ${response.status}`)
    }

    const data = (await response.json()) as CirclebackMeeting[]
    const meetings = Array.isArray(data) ? data : []
    const nextCursor = parseNextCursor(response)

    const allStubs = meetings.filter((meeting) => Boolean(meeting.id)).map(meetingToStub)

    const prevFetched = (syncContext?.totalDocsFetched as number) ?? 0
    let documents = allStubs
    let capDroppedMeetings = false
    if (maxMeetings > 0) {
      const remaining = Math.max(0, maxMeetings - prevFetched)
      if (allStubs.length > remaining) {
        documents = allStubs.slice(0, remaining)
        capDroppedMeetings = true
      }
    }

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched

    const sourceHasMore = Boolean(nextCursor)
    const hitLimit = maxMeetings > 0 && totalFetched >= maxMeetings

    /**
     * Only report the listing as capped when the cap actually hid meetings that
     * still exist — either this page was sliced, or Circleback reports another
     * page. A cap that lands exactly on the last meeting leaves the listing
     * complete, and flagging it there would block deletion reconciliation on
     * every ordinary sync, stranding meetings deleted in Circleback in the
     * knowledge base indefinitely.
     */
    if (syncContext && hitLimit && (capDroppedMeetings || sourceHasMore)) {
      syncContext.listingCapped = true
    }

    const hasMore = !hitLimit && sourceHasMore

    return {
      documents,
      nextCursor: hasMore ? nextCursor : undefined,
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

      const url = `${CIRCLEBACK_API_BASE}/meeting/${encodeURIComponent(externalId)}`

      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: circlebackHeaders(accessToken),
      })

      if (!response.ok) {
        if (response.status === 404) return null
        throw new Error(`Failed to fetch Circleback meeting: ${response.status}`)
      }

      const meeting = (await response.json()) as CirclebackMeeting
      if (!meeting?.id) return null

      let transcript: CirclebackTranscriptSegment[] | null = null
      if (shouldIncludeTranscript(sourceConfig)) {
        const transcriptResponse = await fetchWithRetry(
          `${CIRCLEBACK_API_BASE}/meeting/${encodeURIComponent(externalId)}/transcript`,
          {
            method: 'GET',
            headers: circlebackHeaders(accessToken),
          }
        )
        if (transcriptResponse.ok) {
          const segments = (await transcriptResponse.json()) as CirclebackTranscriptSegment[]
          transcript = Array.isArray(segments) ? segments : null
        } else if (transcriptResponse.status !== 404) {
          /* A missing transcript (404) degrades to notes-only; other failures
             are rethrown so the already-indexed document is preserved. */
          throw new Error(`Failed to fetch Circleback transcript: ${transcriptResponse.status}`)
        }
      }

      const content = buildContent(meeting, transcript)
      if (!content) {
        logger.info('Circleback meeting has no content', { externalId })
        return null
      }

      const stub = meetingToStub(meeting)
      return { ...stub, content, contentDeferred: false }
    } catch (error) {
      /**
       * Only a confirmed 404 above returns null (the meeting is gone or not
       * accessible). Everything else — 429 rate limiting, 5xx, network faults —
       * is rethrown so the sync engine records a failed row and preserves the
       * already-indexed document, instead of silently dropping a meeting that
       * still exists.
       */
      logger.warn('Failed to get Circleback meeting', {
        externalId,
        error: toError(error).message,
      })
      throw toError(error)
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

    const ownership = sourceConfig.ownership
    if (
      typeof ownership === 'string' &&
      ownership.trim() &&
      !OWNERSHIP_VALUES.has(ownership.trim())
    ) {
      return { valid: false, error: 'Meetings to sync must be one of Mine, All, or Shared' }
    }

    const tagIdsRaw = sourceConfig.tagIds
    if (typeof tagIdsRaw === 'string' && tagIdsRaw.trim()) {
      const invalid = tagIdsRaw
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .some((entry) => !Number.isInteger(Number(entry)) || Number(entry) <= 0)
      if (invalid) {
        return {
          valid: false,
          error: 'Tag IDs must be a comma-separated list of positive numbers (e.g. 3, 7)',
        }
      }
    }

    try {
      const url = new URL(`${CIRCLEBACK_API_BASE}/tag`)

      const response = await fetchWithRetry(
        url.toString(),
        {
          method: 'GET',
          headers: circlebackHeaders(accessToken),
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return {
          valid: false,
          error: `Circleback access failed: ${response.status}${errorText ? ` — ${errorText.slice(0, 200)}` : ''}`,
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

    if (typeof metadata.title === 'string' && metadata.title.trim()) {
      result.title = metadata.title.trim()
    }

    const attendees = joinTagArray(metadata.attendees)
    if (attendees) result.attendees = attendees

    const tags = joinTagArray(metadata.tags)
    if (tags) result.tags = tags

    const meetingDate = parseTagDate(metadata.meetingDate)
    if (meetingDate) result.meetingDate = meetingDate

    if (metadata.duration != null) {
      const duration = Number(metadata.duration)
      if (!Number.isNaN(duration)) result.duration = duration
    }

    return result
  },
}
