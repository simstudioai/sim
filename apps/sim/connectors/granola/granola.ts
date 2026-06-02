import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { GranolaIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, joinTagArray, parseTagDate } from '@/connectors/utils'

const logger = createLogger('GranolaConnector')

const GRANOLA_API_BASE = 'https://public-api.granola.ai/v1'
/** Granola caps page_size at 30; request the maximum to minimize round trips. */
const PAGE_SIZE = 30

/** Granola folder identifiers match `fol_` followed by 14 alphanumeric chars. */
const FOLDER_ID_PATTERN = /^fol_[a-zA-Z0-9]{14}$/

/**
 * A note owner or attendee as returned by the Granola API.
 */
interface GranolaUser {
  name: string | null
  email: string
}

/**
 * The lightweight note shape returned by the list endpoint. It contains only
 * metadata — no summary or transcript content — so content must be fetched per
 * note via the get endpoint (the deferred-content pattern).
 */
interface GranolaNoteSummary {
  id: string
  object?: string
  title: string | null
  owner?: GranolaUser
  created_at: string
  updated_at: string
}

/**
 * A folder the note belongs to, as returned by the get endpoint.
 */
interface GranolaFolderMembership {
  id: string
  name: string
  parent_folder_id?: string | null
}

/**
 * Calendar event details attached to a note, when available.
 * Field names match the Granola API's CalendarEvent schema.
 */
interface GranolaCalendarEvent {
  event_title?: string | null
  organiser?: string | null
  calendar_event_id?: string | null
  scheduled_start_time?: string | null
  scheduled_end_time?: string | null
  invitees?: { email: string }[]
}

/**
 * The full note shape returned by the get endpoint, including summary content.
 */
interface GranolaNoteDetail extends GranolaNoteSummary {
  web_url?: string | null
  calendar_event?: GranolaCalendarEvent | null
  attendees?: GranolaUser[]
  folder_membership?: GranolaFolderMembership[]
  summary_text?: string | null
  summary_markdown?: string | null
}

/**
 * The list endpoint response envelope.
 */
interface GranolaListNotesResponse {
  notes?: GranolaNoteSummary[]
  hasMore?: boolean
  cursor?: string | null
}

/**
 * Builds the authorization headers for a Granola API request.
 */
function granolaHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Produces the change-detection hash for a note from its stable identifiers.
 * Granola exposes `updated_at`, which advances whenever the note (or its summary)
 * changes, so a metadata-only hash is sufficient and stays identical between the
 * list stub and the fetched document — letting the sync engine skip re-fetching
 * unchanged notes.
 */
function buildContentHash(id: string, updatedAt: string): string {
  return `granola:${id}:${updatedAt}`
}

/**
 * Parses the optional `maxNotes` cap from source config.
 * Returns 0 (unlimited) when unset or invalid.
 */
function parseMaxNotes(sourceConfig: Record<string, unknown>): number {
  const raw = sourceConfig.maxNotes
  if (raw == null || raw === '') return 0
  const num = Number(raw)
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0
}

/**
 * Parses the optional `folderId` scope from source config. Returns a trimmed
 * folder id only when it matches Granola's `fol_…` identifier shape; otherwise
 * returns undefined so the request is not scoped to an invalid folder.
 */
function parseFolderId(sourceConfig: Record<string, unknown>): string | undefined {
  const raw = sourceConfig.folderId
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  return FOLDER_ID_PATTERN.test(trimmed) ? trimmed : undefined
}

/**
 * Parses an optional ISO 8601 date filter from a named source-config field.
 * Returns a normalized ISO 8601 string when the value is a valid date; otherwise
 * returns undefined so the request is not scoped to an invalid date.
 */
function parseDateFilter(sourceConfig: Record<string, unknown>, key: string): string | undefined {
  const raw = sourceConfig[key]
  if (typeof raw !== 'string') return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString()
}

/**
 * Detects whether a string contains HTML markup. Granola returns markdown for
 * `summary_markdown`, but this guard lets us defensively strip tags if the API
 * ever emits HTML, without mangling legitimate markdown.
 */
function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*?>/i.test(value)
}

/**
 * Assembles the document content from a note's title and summary. Prefers the
 * markdown summary, falling back to plain-text summary. HTML is stripped only
 * when detected so markdown formatting is preserved.
 */
function buildContent(note: GranolaNoteDetail): string {
  const parts: string[] = []

  const title = note.title?.trim()
  if (title) parts.push(`# ${title}`)

  const rawSummary = note.summary_markdown?.trim() || note.summary_text?.trim() || ''
  if (rawSummary) {
    parts.push('')
    parts.push(looksLikeHtml(rawSummary) ? htmlToPlainText(rawSummary) : rawSummary)
  }

  return parts.join('\n').trim()
}

/**
 * Resolves an owner's display name, falling back to email, for tag mapping.
 */
function ownerDisplay(owner?: GranolaUser): string | undefined {
  if (!owner) return undefined
  return owner.name?.trim() || owner.email?.trim() || undefined
}

/**
 * Collects attendee display names (falling back to email) for tag mapping.
 */
function collectAttendees(note: GranolaNoteDetail): string[] {
  if (!Array.isArray(note.attendees)) return []
  return note.attendees
    .map((a) => a.name?.trim() || a.email?.trim() || '')
    .filter((name): name is string => name.length > 0)
}

/**
 * Collects folder names for tag mapping.
 */
function collectFolders(note: GranolaNoteDetail): string[] {
  if (!Array.isArray(note.folder_membership)) return []
  return note.folder_membership
    .map((f) => f.name?.trim() || '')
    .filter((name): name is string => name.length > 0)
}

/**
 * Builds the deferred stub for a note from list metadata. Content is empty and
 * fetched later via `getDocument` only for new/changed notes.
 */
function noteSummaryToStub(note: GranolaNoteSummary): ExternalDocument {
  return {
    externalId: note.id,
    title: note.title?.trim() || 'Untitled Note',
    content: '',
    contentDeferred: true,
    mimeType: 'text/markdown',
    contentHash: buildContentHash(note.id, note.updated_at),
    metadata: {
      title: note.title?.trim() || undefined,
      owner: ownerDisplay(note.owner),
      ownerName: note.owner?.name ?? undefined,
      ownerEmail: note.owner?.email ?? undefined,
      noteDate: note.created_at,
      updatedAt: note.updated_at,
    },
  }
}

export const granolaConnector: ConnectorConfig = {
  id: 'granola',
  name: 'Granola',
  description: 'Sync AI meeting notes and summaries from Granola',
  version: '1.0.0',
  icon: GranolaIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your Granola API key',
  },

  supportsIncrementalSync: true,

  configFields: [
    {
      id: 'maxNotes',
      title: 'Max Notes',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 200 (default: unlimited)',
      description: 'Cap the number of notes synced. Leave blank to sync all notes.',
    },
    {
      id: 'folderId',
      title: 'Folder ID',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. fol_4y6LduVdwSKC27',
      description:
        'Scope the sync to a single folder and its child folders. Leave blank to sync notes from all folders.',
    },
    {
      id: 'createdAfter',
      title: 'Created After',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 2025-01-01 or 2025-01-01T00:00:00Z',
      description:
        'Only sync notes created on or after this date (ISO 8601). Leave blank to sync notes regardless of creation date.',
    },
    {
      id: 'createdBefore',
      title: 'Created Before',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 2025-12-31 or 2025-12-31T23:59:59Z',
      description:
        'Only sync notes created on or before this date (ISO 8601). Leave blank to sync notes regardless of creation date.',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>,
    lastSyncAt?: Date
  ): Promise<ExternalDocumentList> => {
    const maxNotes = parseMaxNotes(sourceConfig)
    const folderId = parseFolderId(sourceConfig)
    const createdAfter = parseDateFilter(sourceConfig, 'createdAfter')
    const createdBefore = parseDateFilter(sourceConfig, 'createdBefore')

    const url = new URL(`${GRANOLA_API_BASE}/notes`)
    url.searchParams.set('page_size', String(PAGE_SIZE))
    if (cursor) url.searchParams.set('cursor', cursor)
    if (lastSyncAt) url.searchParams.set('updated_after', lastSyncAt.toISOString())
    if (folderId) url.searchParams.set('folder_id', folderId)
    if (createdAfter) url.searchParams.set('created_after', createdAfter)
    if (createdBefore) url.searchParams.set('created_before', createdBefore)

    logger.info('Listing Granola notes', {
      hasCursor: Boolean(cursor),
      incremental: Boolean(lastSyncAt),
      scopedToFolder: Boolean(folderId),
      scopedByCreatedAfter: Boolean(createdAfter),
      scopedByCreatedBefore: Boolean(createdBefore),
    })

    const response = await fetchWithRetry(url.toString(), {
      method: 'GET',
      headers: granolaHeaders(accessToken),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error('Failed to list Granola notes', {
        status: response.status,
        error: errorText.slice(0, 500),
      })
      throw new Error(`Failed to list Granola notes: ${response.status}`)
    }

    const data = (await response.json()) as GranolaListNotesResponse
    const notes = Array.isArray(data.notes) ? data.notes : []
    const nextCursor = data.cursor?.trim() || undefined

    const allStubs = notes.filter((note) => Boolean(note.id)).map((note) => noteSummaryToStub(note))

    const prevFetched = (syncContext?.totalDocsFetched as number) ?? 0
    let documents = allStubs
    if (maxNotes > 0) {
      const remaining = Math.max(0, maxNotes - prevFetched)
      if (allStubs.length > remaining) {
        documents = allStubs.slice(0, remaining)
      }
    }

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched

    const hitLimit = maxNotes > 0 && totalFetched >= maxNotes
    if (hitLimit && syncContext) syncContext.listingCapped = true

    const hasMore = !hitLimit && Boolean(data.hasMore) && Boolean(nextCursor)

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

      const url = `${GRANOLA_API_BASE}/notes/${encodeURIComponent(externalId)}`

      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: granolaHeaders(accessToken),
      })

      if (!response.ok) {
        if (response.status === 404 || response.status === 410) return null
        throw new Error(`Failed to fetch Granola note: ${response.status}`)
      }

      const note = (await response.json()) as GranolaNoteDetail
      if (!note?.id) return null

      const content = buildContent(note)
      if (!content) {
        logger.info('Granola note has no content', { externalId })
        return null
      }

      const attendees = collectAttendees(note)
      const folders = collectFolders(note)
      const meeting = note.calendar_event?.event_title?.trim() || undefined
      const meetingDate = note.calendar_event?.scheduled_start_time?.trim() || undefined

      return {
        externalId: note.id,
        title: note.title?.trim() || 'Untitled Note',
        content,
        contentDeferred: false,
        mimeType: 'text/markdown',
        sourceUrl: note.web_url?.trim() || undefined,
        contentHash: buildContentHash(note.id, note.updated_at),
        metadata: {
          title: note.title?.trim() || undefined,
          owner: ownerDisplay(note.owner),
          ownerName: note.owner?.name ?? undefined,
          ownerEmail: note.owner?.email ?? undefined,
          noteDate: note.created_at,
          updatedAt: note.updated_at,
          attendees,
          folders,
          meeting,
          meetingDate,
        },
      }
    } catch (error) {
      logger.warn('Failed to get Granola note', {
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
    const maxNotes = sourceConfig.maxNotes as string | undefined
    if (maxNotes && (Number.isNaN(Number(maxNotes)) || Number(maxNotes) < 0)) {
      return { valid: false, error: 'Max notes must be a non-negative number' }
    }

    const folderId = sourceConfig.folderId
    if (
      typeof folderId === 'string' &&
      folderId.trim() &&
      !FOLDER_ID_PATTERN.test(folderId.trim())
    ) {
      return {
        valid: false,
        error:
          'Folder ID must look like fol_ followed by 14 alphanumeric characters (e.g. fol_4y6LduVdwSKC27)',
      }
    }

    const createdAfter = sourceConfig.createdAfter
    if (
      typeof createdAfter === 'string' &&
      createdAfter.trim() &&
      Number.isNaN(new Date(createdAfter.trim()).getTime())
    ) {
      return {
        valid: false,
        error:
          'Created After must be a valid date (ISO 8601, e.g. 2025-01-01 or 2025-01-01T00:00:00Z)',
      }
    }

    const createdBefore = sourceConfig.createdBefore
    if (
      typeof createdBefore === 'string' &&
      createdBefore.trim() &&
      Number.isNaN(new Date(createdBefore.trim()).getTime())
    ) {
      return {
        valid: false,
        error:
          'Created Before must be a valid date (ISO 8601, e.g. 2025-12-31 or 2025-12-31T23:59:59Z)',
      }
    }

    try {
      const url = new URL(`${GRANOLA_API_BASE}/notes`)
      url.searchParams.set('page_size', '1')

      const response = await fetchWithRetry(
        url.toString(),
        {
          method: 'GET',
          headers: granolaHeaders(accessToken),
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return {
          valid: false,
          error: `Granola access failed: ${response.status}${errorText ? ` — ${errorText.slice(0, 200)}` : ''}`,
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
    { id: 'owner', displayName: 'Owner', fieldType: 'text' },
    { id: 'attendees', displayName: 'Attendees', fieldType: 'text' },
    { id: 'folders', displayName: 'Folders', fieldType: 'text' },
    { id: 'meeting', displayName: 'Meeting', fieldType: 'text' },
    { id: 'noteDate', displayName: 'Note Date', fieldType: 'date' },
    { id: 'meetingDate', displayName: 'Meeting Date', fieldType: 'date' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.title === 'string' && metadata.title.trim()) {
      result.title = metadata.title.trim()
    }

    if (typeof metadata.owner === 'string' && metadata.owner.trim()) {
      result.owner = metadata.owner.trim()
    }

    const attendees = joinTagArray(metadata.attendees)
    if (attendees) result.attendees = attendees

    const folders = joinTagArray(metadata.folders)
    if (folders) result.folders = folders

    if (typeof metadata.meeting === 'string' && metadata.meeting.trim()) {
      result.meeting = metadata.meeting.trim()
    }

    const noteDate = parseTagDate(metadata.noteDate)
    if (noteDate) result.noteDate = noteDate

    const meetingDate = parseTagDate(metadata.meetingDate)
    if (meetingDate) result.meetingDate = meetingDate

    return result
  },
}
