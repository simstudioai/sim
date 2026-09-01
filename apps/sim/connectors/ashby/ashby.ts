import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import {
  readResponseJsonWithLimit,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { ashbyConnectorMeta } from '@/connectors/ashby/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseTagDate } from '@/connectors/utils'

const logger = createLogger('AshbyConnector')

const ASHBY_API_BASE = 'https://api.ashbyhq.com'
const CANDIDATES_PER_PAGE = 100
const NOTES_PER_PAGE = 100
const FEEDBACK_PER_PAGE = 100
const MAX_ASHBY_RESPONSE_BYTES = 10 * 1024 * 1024
const MAX_NOTES_PER_CANDIDATE = 200
const MAX_FEEDBACK_PER_CANDIDATE = 500
const MAX_FEEDBACK_FIELDS_PER_SUBMISSION = 100
const MAX_TEXT_FIELD_CHARACTERS = 20_000
const MAX_FEEDBACK_SUBMISSION_CHARACTERS = 100_000
const MAX_DOCUMENT_CHARACTERS = 2_000_000

/**
 * Hard cap on the number of applications whose interview feedback is fetched for a
 * single candidate document. Candidates with many applications are rare, but this
 * bounds the number of feedback API calls per `getDocument` invocation.
 */
const MAX_APPLICATIONS_FOR_FEEDBACK = 10

type UnknownRecord = Record<string, unknown>

/**
 * Builds the standard Ashby Authorization header. Ashby uses HTTP Basic auth with
 * the API key as the username and an empty password, i.e. `Basic base64(apiKey + ':')`.
 */
function ashbyHeaders(accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json; version=1',
    Authorization: `Basic ${Buffer.from(`${accessToken}:`).toString('base64')}`,
  }
}

interface AshbyEnvelope {
  success: boolean
  results?: unknown
  moreDataAvailable?: boolean
  nextCursor?: string | null
  errors?: unknown
  errorInfo?: { message?: string }
}

/**
 * Extracts a human-readable error message from an Ashby error envelope. The documented
 * failure body is `{ success: false, errors: [{ message }] }`, but `errorInfo.message`
 * and plain-string `errors` entries also occur, so all three are handled. Reading the
 * object entry's `message` explicitly is what keeps it from stringifying to
 * `[object Object]`.
 */
function ashbyErrorMessage(data: AshbyEnvelope, fallback: string): string {
  if (data.errorInfo?.message) return data.errorInfo.message
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    const messages = data.errors
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim()
        if (entry && typeof entry === 'object') {
          const e = entry as UnknownRecord
          const message = typeof e.message === 'string' ? e.message.trim() : ''
          const parameter = typeof e.parameter === 'string' ? e.parameter.trim() : ''
          if (message && parameter) return `${message} (${parameter})`
          if (message) return message
        }
        return ''
      })
      .filter(Boolean)
    if (messages.length > 0) return messages.join('; ')
  }
  return fallback
}

/**
 * Executes an Ashby RPC-style POST request and returns the parsed envelope.
 * Ashby exposes a flat set of POST endpoints under `https://api.ashbyhq.com`.
 */
async function ashbyPost(
  accessToken: string,
  endpoint: string,
  body: UnknownRecord,
  retryOptions?: Parameters<typeof fetchWithRetry>[2]
): Promise<AshbyEnvelope> {
  const response = await fetchWithRetry(
    `${ASHBY_API_BASE}/${endpoint}`,
    {
      method: 'POST',
      headers: ashbyHeaders(accessToken),
      body: JSON.stringify(body),
    },
    retryOptions
  )

  if (!response.ok) {
    const errorText = await readResponseTextWithLimit(response, {
      maxBytes: MAX_ASHBY_RESPONSE_BYTES,
      label: `Ashby ${endpoint} error response`,
    }).catch(() => '')
    throw new Error(
      `Ashby ${endpoint} HTTP error: ${response.status}${errorText ? ` — ${errorText.slice(0, 300)}` : ''}`
    )
  }

  const data = await readResponseJsonWithLimit<AshbyEnvelope>(response, {
    maxBytes: MAX_ASHBY_RESPONSE_BYTES,
    label: `Ashby ${endpoint} response`,
  })
  if (!data.success) {
    throw new Error(ashbyErrorMessage(data, `Ashby ${endpoint} request failed`))
  }
  return data
}

interface AshbyCandidateSummary {
  id: string
  name: string
  position: string | null
  company: string | null
  school: string | null
  location: string | null
  source: string | null
  emailDomain: string | null
  profileUrl: string | null
  applicationIds: string[]
  createdAt: string | null
  updatedAt: string | null
}

/**
 * Extracts a human-readable location string from an Ashby candidate's `location`
 * object. Prefers the API-provided `locationSummary`. Falls back to joining the
 * `name` values of the `locationComponents` array (each entry is `{ type, name }`
 * ordered city → region → country, per the candidate entity returned by
 * `candidate.list`/`candidate.info`). As a final fallback, supports the flat
 * `{ city, region, country }` shape used by candidate write inputs.
 */
function extractLocation(raw: UnknownRecord): string | null {
  const location = raw.location as UnknownRecord | undefined
  if (!location) return null

  const summary = location.locationSummary as string | undefined
  if (summary?.trim()) return summary.trim()

  if (Array.isArray(location.locationComponents)) {
    const parts = (location.locationComponents as UnknownRecord[])
      .map((c) => c?.name)
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      .map((n) => n.trim())
    if (parts.length > 0) return parts.join(', ')
  }

  const parts = [location.city, location.region, location.country]
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .map((p) => p.trim())
  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Extracts the source title from an Ashby candidate's `source` object, which
 * references the organization's sources list (e.g. "LinkedIn", "Referral").
 */
function extractSource(raw: UnknownRecord): string | null {
  const source = raw.source as UnknownRecord | undefined
  const title = source?.title as string | undefined
  return title?.trim() || null
}

/**
 * Extracts the lowercased domain from an Ashby candidate's primary email address
 * (`primaryEmailAddress.value`), enabling filtering candidates by email domain.
 */
function extractEmailDomain(raw: UnknownRecord): string | null {
  const email = raw.primaryEmailAddress as UnknownRecord | undefined
  const value = email?.value as string | undefined
  const at = value?.lastIndexOf('@') ?? -1
  if (!value || at < 0 || at === value.length - 1) return null
  return (
    value
      .slice(at + 1)
      .trim()
      .toLowerCase() || null
  )
}

/**
 * Normalizes a raw Ashby candidate record into the fields this connector cares about.
 * Field names mirror the Ashby candidate object returned by `candidate.list` and
 * `candidate.info` (`position`, `company`, `school`, `location`, `source`,
 * `primaryEmailAddress`, `profileUrl`, `applicationIds`, `createdAt`, `updatedAt`).
 * Stage and status live on applications rather than candidates, so they are
 * intentionally not surfaced here.
 */
function mapCandidate(raw: unknown): AshbyCandidateSummary {
  const c = (raw ?? {}) as UnknownRecord
  return {
    id: (c.id as string) ?? '',
    name: (c.name as string) ?? '',
    position: (c.position as string) ?? null,
    company: (c.company as string) ?? null,
    school: (c.school as string) ?? null,
    location: extractLocation(c),
    source: extractSource(c),
    emailDomain: extractEmailDomain(c),
    profileUrl: (c.profileUrl as string) ?? null,
    applicationIds: Array.isArray(c.applicationIds) ? (c.applicationIds as string[]) : [],
    createdAt: (c.createdAt as string) ?? null,
    updatedAt: (c.updatedAt as string) ?? null,
  }
}

interface AshbyNote {
  content: string | null
  authorName: string | null
  createdAt: string | null
}

/**
 * Maps a raw Ashby candidate note into a plain-text-friendly shape, combining the
 * author's first and last name into a single display name.
 */
function mapNote(raw: unknown): AshbyNote {
  const n = (raw ?? {}) as UnknownRecord
  const author = n.author as UnknownRecord | undefined
  const first = (author?.firstName as string) ?? ''
  const last = (author?.lastName as string) ?? ''
  const authorName = `${first} ${last}`.trim() || (author?.email as string) || null
  const content = typeof n.content === 'string' ? n.content : null
  return {
    content: content ? truncate(content, MAX_TEXT_FIELD_CHARACTERS) : null,
    authorName,
    createdAt: (n.createdAt as string) ?? null,
  }
}

interface AshbyFeedbackSummary {
  submittedByName: string | null
  submittedAt: string | null
  lines: string[]
}

interface AshbyFeedbackField {
  title: string
  /** `selectableValues` stored value -> display label, for select-type fields. */
  labelByValue: Map<string, string>
}

/**
 * Collects `{ field.path -> { title, labelByValue } }` entries from a feedback form
 * definition. Ashby's `formDefinition` exposes fields either flat under `fields[]` or
 * grouped under `sections[].fields[]`, and individual entries are sometimes wrapped in a
 * `{ isRequired, field }` envelope — all variants are handled.
 *
 * Select-type fields (`ValueSelect`, `MultiValueSelect`, `Score`) return the stored
 * option value in `submittedValues`, not its display label, so `selectableValues`
 * (`[{ label, value }]`) is indexed here to render human-readable text.
 *
 * Ref: https://developers.ashbyhq.com/reference/applicationfeedbacklist
 */
function collectFeedbackFields(
  formDefinition: UnknownRecord | undefined
): Map<string, AshbyFeedbackField> {
  const fieldByPath = new Map<string, AshbyFeedbackField>()
  if (!formDefinition) return fieldByPath

  const addField = (entry: UnknownRecord): void => {
    const field = (entry?.field ?? entry) as UnknownRecord
    const path = field?.path as string | undefined
    if (!path) return

    const title = (field?.title as string) || (field?.humanReadablePath as string) || path
    const labelByValue = new Map<string, string>()
    if (Array.isArray(field?.selectableValues)) {
      for (const option of field.selectableValues as UnknownRecord[]) {
        const label = option?.label
        const value = option?.value
        const isScalar =
          typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        if (typeof label === 'string' && label.trim() && isScalar) {
          labelByValue.set(String(value), label.trim())
        }
      }
    }

    fieldByPath.set(path, { title, labelByValue })
  }

  if (Array.isArray(formDefinition.fields)) {
    for (const entry of formDefinition.fields as UnknownRecord[]) addField(entry)
  }

  if (Array.isArray(formDefinition.sections)) {
    for (const section of formDefinition.sections as UnknownRecord[]) {
      const fields = Array.isArray(section?.fields) ? (section.fields as UnknownRecord[]) : []
      for (const entry of fields) addField(entry)
    }
  }

  return fieldByPath
}

/**
 * Maps a raw Ashby application feedback submission into a flat list of
 * `Title: value` lines, resolving each `submittedValues` key (the field's `path`)
 * to its human-readable title via the form definition. Falls back to the raw path
 * when no title is found.
 */
function mapFeedback(raw: unknown): AshbyFeedbackSummary {
  const f = (raw ?? {}) as UnknownRecord
  const submittedBy = f.submittedByUser as UnknownRecord | undefined
  const first = (submittedBy?.firstName as string) ?? ''
  const last = (submittedBy?.lastName as string) ?? ''
  const submittedByName = `${first} ${last}`.trim() || (submittedBy?.email as string) || null

  const fieldByPath = collectFeedbackFields(f.formDefinition as UnknownRecord | undefined)

  const submittedValues = (f.submittedValues as UnknownRecord | undefined) ?? {}
  const lines: string[] = []
  let renderedCharacters = 0
  for (const [path, value] of Object.entries(submittedValues)) {
    if (lines.length >= MAX_FEEDBACK_FIELDS_PER_SUBMISSION) break
    if (value == null) continue
    const field = fieldByPath.get(path)
    const label = field?.title ?? path
    const rendered = truncate(
      renderFeedbackValue(value, field?.labelByValue),
      MAX_TEXT_FIELD_CHARACTERS
    )
    if (!rendered) continue
    const line = `${label}: ${rendered}`
    const remainingCharacters = MAX_FEEDBACK_SUBMISSION_CHARACTERS - renderedCharacters
    if (remainingCharacters <= 0) break
    lines.push(truncate(line, remainingCharacters))
    renderedCharacters += Math.min(line.length, remainingCharacters)
  }

  const submittedAt =
    (f.submittedAt as string) ?? (f.completedAt as string) ?? (f.createdAt as string) ?? null

  return { submittedByName, submittedAt, lines }
}

/**
 * Renders an arbitrary submitted feedback value (string, number, boolean, or a
 * rich-text / structured object) into a single-line plain-text string, resolving
 * select-type stored values to their display label when the field defines one.
 */
function renderFeedbackValue(value: unknown, labelByValue?: Map<string, string>): string {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return labelByValue?.get(trimmed) ?? labelByValue?.get(value) ?? trimmed
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return labelByValue?.get(String(value)) ?? String(value)
  }
  if (Array.isArray(value)) {
    return value
      .map((v) => renderFeedbackValue(v, labelByValue))
      .filter(Boolean)
      .join(', ')
  }
  if (value && typeof value === 'object') {
    const obj = value as UnknownRecord
    const label = obj.label ?? obj.value ?? obj.text ?? obj.content
    if (typeof label === 'string') return label.trim()
  }
  return ''
}

/**
 * Stable, metadata-based content hash for a candidate document. Identical between the
 * listing stub and the fully-fetched document so unchanged candidates are skipped,
 * which keeps the `getDocument` re-hydration (notes + feedback fetches) cheap: the
 * sync engine only re-hydrates a deferred stub when this hash differs from the stored
 * document's hash (see `lib/knowledge/connectors/sync-engine.ts`).
 *
 * Known limitation — notes/feedback freshness depends on `candidate.updatedAt`.
 * Candidate notes (`candidate.listNotes`) and interview feedback
 * (`applicationFeedback.list`) are separate Ashby objects, not candidate fields. This
 * hash is derived solely from the candidate's own `updatedAt`, so a new note or newly
 * submitted feedback is only re-synced if Ashby advances `candidate.updatedAt` as a
 * side effect of that write.
 *
 * As of this writing Ashby's public API docs do not specify what counts as a
 * "modification" for `candidate.updatedAt` or for `candidate.list` syncToken
 * incremental sync, and no third-party ATS-integration vendor (Merge, Nango, Knit)
 * documents it either — so this behavior is unverified. If Ashby does NOT touch
 * `candidate.updatedAt` on note/feedback writes, those additions will not be picked up
 * until some other candidate field changes; a forced full sync re-hydrates everything
 * regardless. No cheaper listing-time signal exists to fold into this hash: the
 * `candidate.list` object exposes no note/feedback count, and syncToken carries the
 * same unspecified change semantics as `updatedAt`.
 *
 * Refs:
 * - https://developers.ashbyhq.com/reference/candidatelist
 * - https://developers.ashbyhq.com/reference/candidatecreatenote
 * - https://developers.ashbyhq.com/docs/pagination-and-incremental-sync
 */
function buildContentHash(id: string, updatedAt: string | null): string {
  return `ashby:${id}:${updatedAt ?? ''}`
}

/**
 * Creates a lightweight document stub from a candidate listing entry. Content is
 * deferred and only fetched (via `getDocument`) for new or changed candidates.
 */
function candidateToStub(candidate: AshbyCandidateSummary): ExternalDocument {
  return {
    externalId: candidate.id,
    title: candidate.name || 'Unnamed Candidate',
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: candidate.profileUrl ?? undefined,
    contentHash: buildContentHash(candidate.id, candidate.updatedAt),
    metadata: candidateMetadata(candidate),
  }
}

/**
 * Builds the tag-carrying metadata block shared by the listing stub and the
 * fully-fetched document, keeping the keys aligned with `mapTags`/`tagDefinitions`.
 */
function candidateMetadata(candidate: AshbyCandidateSummary): Record<string, unknown> {
  return {
    candidateName: candidate.name,
    company: candidate.company,
    school: candidate.school,
    location: candidate.location,
    source: candidate.source,
    emailDomain: candidate.emailDomain,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
  }
}

/**
 * Fetches all notes for a candidate, following cursor pagination.
 */
async function fetchAllNotes(accessToken: string, candidateId: string): Promise<AshbyNote[]> {
  const notes: AshbyNote[] = []
  let cursor: string | undefined
  const seenCursors = new Set<string>()

  while (notes.length < MAX_NOTES_PER_CANDIDATE) {
    const body: UnknownRecord = { candidateId, limit: NOTES_PER_PAGE }
    if (cursor) body.cursor = cursor
    const data = await ashbyPost(accessToken, 'candidate.listNotes', body)
    const results = Array.isArray(data.results) ? data.results : []
    for (const raw of results) {
      if (notes.length >= MAX_NOTES_PER_CANDIDATE) break
      notes.push(mapNote(raw))
    }
    if (!data.moreDataAvailable || notes.length >= MAX_NOTES_PER_CANDIDATE) break
    const nextCursor = data.nextCursor?.trim()
    if (!nextCursor) {
      throw new Error('Ashby candidate.listNotes reported more data without a next cursor')
    }
    if (seenCursors.has(nextCursor)) {
      throw new Error('Ashby candidate.listNotes repeated a pagination cursor')
    }
    if (results.length === 0) {
      throw new Error('Ashby candidate.listNotes returned an empty non-final page')
    }
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }

  return notes
}

/**
 * Fetches all interview feedback submissions for a single application, following
 * cursor pagination.
 */
async function fetchFeedbackForApplication(
  accessToken: string,
  applicationId: string
): Promise<AshbyFeedbackSummary[]> {
  const feedback: AshbyFeedbackSummary[] = []
  let cursor: string | undefined
  const seenCursors = new Set<string>()

  while (feedback.length < MAX_FEEDBACK_PER_CANDIDATE) {
    const body: UnknownRecord = { applicationId, limit: FEEDBACK_PER_PAGE }
    if (cursor) body.cursor = cursor
    const data = await ashbyPost(accessToken, 'applicationFeedback.list', body)
    const results = Array.isArray(data.results) ? data.results : []
    for (const raw of results) {
      if (feedback.length >= MAX_FEEDBACK_PER_CANDIDATE) break
      feedback.push(mapFeedback(raw))
    }
    if (!data.moreDataAvailable || feedback.length >= MAX_FEEDBACK_PER_CANDIDATE) break
    const nextCursor = data.nextCursor?.trim()
    if (!nextCursor) {
      throw new Error('Ashby applicationFeedback.list reported more data without a next cursor')
    }
    if (seenCursors.has(nextCursor)) {
      throw new Error('Ashby applicationFeedback.list repeated a pagination cursor')
    }
    if (results.length === 0) {
      throw new Error('Ashby applicationFeedback.list returned an empty non-final page')
    }
    seenCursors.add(nextCursor)
    cursor = nextCursor
  }

  return feedback
}

/**
 * Assembles a candidate's profile, notes, and interview feedback into a single
 * plain-text document body for indexing.
 */
function formatCandidateContent(
  candidate: AshbyCandidateSummary,
  notes: AshbyNote[],
  feedback: AshbyFeedbackSummary[]
): string {
  const truncationMarker = `[Content truncated at ${MAX_DOCUMENT_CHARACTERS.toLocaleString()} characters by the Ashby connector.]`
  const contentBudget = MAX_DOCUMENT_CHARACTERS - truncationMarker.length - 2
  const parts: string[] = []
  let contentLength = 0
  let wasTruncated = false

  const append = (line: string): boolean => {
    const separatorLength = parts.length > 0 ? 1 : 0
    const remaining = contentBudget - contentLength - separatorLength
    if (remaining <= 0) {
      wasTruncated = true
      return false
    }
    if (line.length > remaining) {
      parts.push(line.slice(0, remaining))
      contentLength += separatorLength + remaining
      wasTruncated = true
      return false
    }
    parts.push(line)
    contentLength += separatorLength + line.length
    return true
  }

  const finish = (): string => {
    const content = parts.join('\n').trim()
    return wasTruncated ? `${content}\n\n${truncationMarker}` : content
  }

  if (!append(`Candidate: ${candidate.name || 'Unnamed Candidate'}`)) return finish()
  if (candidate.position && !append(`Current Role: ${candidate.position}`)) return finish()
  if (candidate.company && !append(`Current Company: ${candidate.company}`)) return finish()
  if (candidate.school && !append(`School: ${candidate.school}`)) return finish()
  if (candidate.location && !append(`Location: ${candidate.location}`)) return finish()
  if (candidate.source && !append(`Source: ${candidate.source}`)) return finish()
  if (candidate.createdAt && !append(`Created: ${candidate.createdAt}`)) return finish()
  if (candidate.updatedAt && !append(`Last Updated: ${candidate.updatedAt}`)) return finish()

  const nonEmptyNotes = notes.filter((n) => n.content?.trim())
  if (nonEmptyNotes.length > 0) {
    if (!append('') || !append('--- Notes ---')) return finish()
    for (const note of nonEmptyNotes) {
      const header = [note.authorName, note.createdAt].filter(Boolean).join(' — ')
      if (header && !append(`[${header}]`)) return finish()
      if (!append((note.content ?? '').trim()) || !append('')) return finish()
    }
  }

  const nonEmptyFeedback = feedback.filter((f) => f.lines.length > 0)
  if (nonEmptyFeedback.length > 0) {
    if (!append('--- Interview Feedback ---')) return finish()
    for (const f of nonEmptyFeedback) {
      const header = [f.submittedByName, f.submittedAt].filter(Boolean).join(' — ')
      if (header && !append(`[${header}]`)) return finish()
      for (const line of f.lines) {
        if (!append(line)) return finish()
      }
      if (!append('')) return finish()
    }
  }

  return finish()
}

export const ashbyConnector: ConnectorConfig = {
  ...ashbyConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const maxCandidates = sourceConfig.maxCandidates ? Number(sourceConfig.maxCandidates) : 0
    const createdAfterMs = (() => {
      const raw = sourceConfig.createdAfter
      if (typeof raw !== 'string' || !raw.trim()) return undefined
      const ms = Date.parse(raw.trim())
      if (!Number.isFinite(ms)) throw new Error('Created after must be a valid ISO 8601 date')
      return ms
    })()

    const prevFetched = (syncContext?.totalCandidatesFetched as number) ?? 0
    if (maxCandidates > 0 && prevFetched >= maxCandidates) {
      return { documents: [], hasMore: false }
    }

    /**
     * `limit` is held constant for every request of a sync: Ashby's `cursor` is
     * opaque and the docs do not say it survives a changed `limit`, and the cap
     * is enforced below by trimming the page instead.
     */
    const remaining = maxCandidates > 0 ? maxCandidates - prevFetched : Number.POSITIVE_INFINITY
    const body: UnknownRecord = { limit: CANDIDATES_PER_PAGE }
    if (cursor) body.cursor = cursor
    if (createdAfterMs !== undefined) body.createdAfter = createdAfterMs

    logger.info('Listing Ashby candidates', {
      cursor: cursor ?? 'initial',
      maxCandidates: maxCandidates || 'unlimited',
    })

    const data = await ashbyPost(accessToken, 'candidate.list', body)
    const results = Array.isArray(data.results) ? data.results : []
    const candidates = results.map(mapCandidate).filter((c) => c.id)

    const stubs = candidates.map(candidateToStub)
    const documents = stubs.length > remaining ? stubs.slice(0, remaining) : stubs
    /** True when the cap hid candidates Ashby already returned on this very page. */
    const droppedInPage = documents.length < stubs.length

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalCandidatesFetched = totalFetched

    const nextCursor = data.nextCursor ?? undefined
    const sourceHasMore = Boolean(data.moreDataAvailable) && Boolean(nextCursor)
    const hitLimit = maxCandidates > 0 && totalFetched >= maxCandidates
    /**
     * `listingCapped` blocks the sync engine's deletion reconciliation, so it is set only
     * when `maxCandidates` made the listing knowingly incomplete — candidates dropped from
     * this page, or pages left unread behind the cap. Never when the cap coincides with
     * genuine exhaustion, and never for the intentional `createdAfter` scope filter.
     */
    if (syncContext && (droppedInPage || (hitLimit && sourceHasMore))) {
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
    _sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    try {
      /**
       * These are API-shape faults, not absence: `candidate.info` answered
       * `success: true` with an unusable payload. Returning `null` would read as
       * documented absence, and on an `add` the engine's `Promise.allSettled`
       * hydration treats a fulfilled `null` as neither success nor failure — no
       * `docsFailed`, no `failedExternalIds`, no log — so the candidate would
       * vanish silently. Ashby sets `contentDeferred`, so this path is live.
       */
      if (!externalId) throw new Error('Ashby getDocument called without a candidate id')

      const infoData = await ashbyPost(accessToken, 'candidate.info', { id: externalId })
      if (!infoData.results) {
        throw new Error(`Ashby candidate.info returned no results for candidate ${externalId}`)
      }
      const candidate = mapCandidate(infoData.results)
      if (!candidate.id) {
        throw new Error(`Ashby candidate.info returned a candidate with no id for ${externalId}`)
      }

      const notes = await fetchAllNotes(accessToken, candidate.id)

      const feedback: AshbyFeedbackSummary[] = []
      const applicationIds = candidate.applicationIds.slice(0, MAX_APPLICATIONS_FOR_FEEDBACK)
      if (candidate.applicationIds.length > applicationIds.length) {
        logger.warn('Truncated Ashby feedback fetch to the per-candidate application cap', {
          externalId,
          applications: candidate.applicationIds.length,
          fetched: applicationIds.length,
        })
      }

      /**
       * Sequential on purpose. The sync engine already hydrates candidates in
       * batches, so per-candidate fan-out would multiply provider concurrency.
       * A feedback failure aborts hydration so a partial document is retried
       * instead of being stored under the candidate's unchanged content hash.
       */
      for (const applicationId of applicationIds) {
        const remainingFeedback = MAX_FEEDBACK_PER_CANDIDATE - feedback.length
        if (remainingFeedback <= 0) break
        feedback.push(
          ...(await fetchFeedbackForApplication(accessToken, applicationId)).slice(
            0,
            remainingFeedback
          )
        )
      }

      const content = formatCandidateContent(candidate, notes, feedback)
      if (!content.trim()) return null

      return {
        externalId: candidate.id,
        title: candidate.name || 'Unnamed Candidate',
        content,
        contentDeferred: false,
        mimeType: 'text/plain',
        sourceUrl: candidate.profileUrl ?? undefined,
        contentHash: buildContentHash(candidate.id, candidate.updatedAt),
        metadata: candidateMetadata(candidate),
      }
    } catch (error) {
      /**
       * Ashby documents no not-found code for `candidate.info`, so a thrown error cannot
       * be read as absence — it is an HTTP fault or a `success: false` envelope. Rethrow
       * so the sync engine records a failed row instead of treating a candidate that
       * still exists as an empty re-fetch and leaving it silently stale.
       */
      logger.warn('Failed to get Ashby candidate', {
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
    const maxCandidates = sourceConfig.maxCandidates
    if (maxCandidates !== undefined && maxCandidates !== null && maxCandidates !== '') {
      const parsed = Number(maxCandidates)
      if (!Number.isSafeInteger(parsed) || parsed < 0) {
        return { valid: false, error: 'Max candidates must be a non-negative safe integer' }
      }
    }
    const createdAfter = sourceConfig.createdAfter
    if (
      typeof createdAfter === 'string' &&
      createdAfter.trim() &&
      !Number.isFinite(Date.parse(createdAfter.trim()))
    ) {
      return { valid: false, error: 'Created after must be a valid ISO 8601 date' }
    }

    try {
      await ashbyPost(accessToken, 'candidate.list', { limit: 1 }, VALIDATE_RETRY_OPTIONS)
      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    const textTags = ['candidateName', 'company', 'school', 'location', 'source', 'emailDomain']
    for (const key of textTags) {
      const value = metadata[key]
      if (typeof value === 'string' && value.trim()) result[key] = value.trim()
    }

    const createdAt = parseTagDate(metadata.createdAt)
    if (createdAt) result.createdAt = createdAt

    const updatedAt = parseTagDate(metadata.updatedAt)
    if (updatedAt) result.updatedAt = updatedAt

    return result
  },
}
