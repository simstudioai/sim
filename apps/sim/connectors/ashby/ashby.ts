import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { AshbyIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseTagDate } from '@/connectors/utils'

const logger = createLogger('AshbyConnector')

const ASHBY_API_BASE = 'https://api.ashbyhq.com'
const CANDIDATES_PER_PAGE = 100
const NOTES_PER_PAGE = 100
const FEEDBACK_PER_PAGE = 100

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
 * Extracts a human-readable error message from an Ashby error envelope. Ashby returns
 * errors as either `errorInfo.message` or an `errors` string array.
 */
function ashbyErrorMessage(data: AshbyEnvelope, fallback: string): string {
  if (data.errorInfo?.message) return data.errorInfo.message
  if (Array.isArray(data.errors) && data.errors.length > 0) {
    return data.errors.map((e) => String(e)).join('; ')
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
    const errorText = await response.text().catch(() => '')
    throw new Error(
      `Ashby ${endpoint} HTTP error: ${response.status}${errorText ? ` — ${errorText.slice(0, 300)}` : ''}`
    )
  }

  const data = (await response.json()) as AshbyEnvelope
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
  return {
    content: (n.content as string) ?? null,
    authorName,
    createdAt: (n.createdAt as string) ?? null,
  }
}

interface AshbyFeedbackSummary {
  submittedByName: string | null
  submittedAt: string | null
  lines: string[]
}

/**
 * Collects `{ field.path -> field.title }` entries from a feedback form definition.
 * Ashby's `formDefinition` exposes fields either flat under `fields[]` or grouped
 * under `sections[].fields[]`, and individual entries are sometimes wrapped in a
 * `{ field }` envelope — all variants are handled.
 */
function collectFieldTitles(formDefinition: UnknownRecord | undefined): Map<string, string> {
  const titleByPath = new Map<string, string>()
  if (!formDefinition) return titleByPath

  const addField = (entry: UnknownRecord): void => {
    const field = (entry?.field ?? entry) as UnknownRecord
    const path = field?.path as string | undefined
    const title = (field?.title as string) || (field?.humanReadablePath as string)
    if (path && title) titleByPath.set(path, title)
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

  return titleByPath
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

  const titleByPath = collectFieldTitles(f.formDefinition as UnknownRecord | undefined)

  const submittedValues = (f.submittedValues as UnknownRecord | undefined) ?? {}
  const lines: string[] = []
  for (const [path, value] of Object.entries(submittedValues)) {
    if (value == null) continue
    const label = titleByPath.get(path) ?? path
    const rendered = renderFeedbackValue(value)
    if (rendered) lines.push(`${label}: ${rendered}`)
  }

  const submittedAt =
    (f.submittedAt as string) ?? (f.completedAt as string) ?? (f.createdAt as string) ?? null

  return { submittedByName, submittedAt, lines }
}

/**
 * Renders an arbitrary submitted feedback value (string, number, boolean, or a
 * rich-text / structured object) into a single-line plain-text string.
 */
function renderFeedbackValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return value
      .map((v) => renderFeedbackValue(v))
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
  let hasMore = true

  while (hasMore) {
    const body: UnknownRecord = { candidateId, limit: NOTES_PER_PAGE }
    if (cursor) body.cursor = cursor
    const data = await ashbyPost(accessToken, 'candidate.listNotes', body)
    const results = Array.isArray(data.results) ? data.results : []
    for (const raw of results) notes.push(mapNote(raw))
    cursor = data.nextCursor ?? undefined
    hasMore = Boolean(data.moreDataAvailable) && Boolean(cursor)
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
  let hasMore = true

  while (hasMore) {
    const body: UnknownRecord = { applicationId, limit: FEEDBACK_PER_PAGE }
    if (cursor) body.cursor = cursor
    const data = await ashbyPost(accessToken, 'applicationFeedback.list', body)
    const results = Array.isArray(data.results) ? data.results : []
    for (const raw of results) feedback.push(mapFeedback(raw))
    cursor = data.nextCursor ?? undefined
    hasMore = Boolean(data.moreDataAvailable) && Boolean(cursor)
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
  const parts: string[] = []

  parts.push(`Candidate: ${candidate.name || 'Unnamed Candidate'}`)
  if (candidate.position) parts.push(`Current Role: ${candidate.position}`)
  if (candidate.company) parts.push(`Current Company: ${candidate.company}`)
  if (candidate.school) parts.push(`School: ${candidate.school}`)
  if (candidate.location) parts.push(`Location: ${candidate.location}`)
  if (candidate.source) parts.push(`Source: ${candidate.source}`)
  if (candidate.createdAt) parts.push(`Created: ${candidate.createdAt}`)
  if (candidate.updatedAt) parts.push(`Last Updated: ${candidate.updatedAt}`)

  const nonEmptyNotes = notes.filter((n) => n.content?.trim())
  if (nonEmptyNotes.length > 0) {
    parts.push('')
    parts.push('--- Notes ---')
    for (const note of nonEmptyNotes) {
      const header = [note.authorName, note.createdAt].filter(Boolean).join(' — ')
      if (header) parts.push(`[${header}]`)
      parts.push((note.content ?? '').trim())
      parts.push('')
    }
  }

  const nonEmptyFeedback = feedback.filter((f) => f.lines.length > 0)
  if (nonEmptyFeedback.length > 0) {
    parts.push('--- Interview Feedback ---')
    for (const f of nonEmptyFeedback) {
      const header = [f.submittedByName, f.submittedAt].filter(Boolean).join(' — ')
      if (header) parts.push(`[${header}]`)
      for (const line of f.lines) parts.push(line)
      parts.push('')
    }
  }

  return parts.join('\n').trim()
}

export const ashbyConnector: ConnectorConfig = {
  id: 'ashby',
  name: 'Ashby',
  description: 'Sync candidate notes and interview feedback from Ashby',
  version: '1.0.0',
  icon: AshbyIcon,

  auth: {
    mode: 'apiKey',
    label: 'API Key',
    placeholder: 'Enter your Ashby API key',
  },

  configFields: [
    {
      id: 'maxCandidates',
      title: 'Max Candidates',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
      description:
        'Cap the number of candidates synced. Leave empty to sync ALL candidates in the organization.',
    },
    {
      id: 'createdAfter',
      title: 'Created After',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. 2025-01-01 or 2025-01-01T00:00:00Z',
      description:
        'Only sync candidates created on or after this date (ISO 8601). Leave blank to sync candidates regardless of creation date.',
    },
  ],

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
      const ms = new Date(raw.trim()).getTime()
      return Number.isNaN(ms) ? undefined : ms
    })()

    const prevFetched = (syncContext?.totalCandidatesFetched as number) ?? 0
    if (maxCandidates > 0 && prevFetched >= maxCandidates) {
      if (syncContext) syncContext.listingCapped = true
      return { documents: [], hasMore: false }
    }

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

    let documents = candidates.map(candidateToStub)
    if (maxCandidates > 0) {
      const remaining = Math.max(0, maxCandidates - prevFetched)
      if (documents.length > remaining) documents = documents.slice(0, remaining)
    }

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalCandidatesFetched = totalFetched
    const hitLimit = maxCandidates > 0 && totalFetched >= maxCandidates
    if (hitLimit && syncContext) syncContext.listingCapped = true

    const nextCursor = data.nextCursor ?? undefined
    const hasMore = !hitLimit && Boolean(data.moreDataAvailable) && Boolean(nextCursor)

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

      const infoData = await ashbyPost(accessToken, 'candidate.info', { id: externalId })
      if (!infoData.results) return null
      const candidate = mapCandidate(infoData.results)
      if (!candidate.id) return null

      const notes = await fetchAllNotes(accessToken, candidate.id)

      const feedback: AshbyFeedbackSummary[] = []
      const applicationIds = candidate.applicationIds.slice(0, MAX_APPLICATIONS_FOR_FEEDBACK)
      for (const applicationId of applicationIds) {
        try {
          const applicationFeedback = await fetchFeedbackForApplication(accessToken, applicationId)
          feedback.push(...applicationFeedback)
        } catch (error) {
          logger.warn('Failed to fetch Ashby feedback for application', {
            applicationId,
            error: toError(error).message,
          })
        }
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
      logger.warn('Failed to get Ashby candidate', {
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
    const maxCandidates = sourceConfig.maxCandidates as string | undefined
    if (maxCandidates && (Number.isNaN(Number(maxCandidates)) || Number(maxCandidates) < 0)) {
      return { valid: false, error: 'Max candidates must be a non-negative number' }
    }

    try {
      await ashbyPost(accessToken, 'candidate.list', { limit: 1 }, VALIDATE_RETRY_OPTIONS)
      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'candidateName', displayName: 'Candidate Name', fieldType: 'text' },
    { id: 'company', displayName: 'Current Company', fieldType: 'text' },
    { id: 'school', displayName: 'School', fieldType: 'text' },
    { id: 'location', displayName: 'Location', fieldType: 'text' },
    { id: 'source', displayName: 'Source', fieldType: 'text' },
    { id: 'emailDomain', displayName: 'Email Domain', fieldType: 'text' },
    { id: 'createdAt', displayName: 'Created', fieldType: 'date' },
    { id: 'updatedAt', displayName: 'Last Updated', fieldType: 'date' },
  ],

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
