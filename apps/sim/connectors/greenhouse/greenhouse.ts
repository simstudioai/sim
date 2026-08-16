import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { greenhouseConnectorMeta } from '@/connectors/greenhouse/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { htmlToPlainText, parseTagDate } from '@/connectors/utils'

const logger = createLogger('GreenhouseConnector')

const GREENHOUSE_API_BASE = 'https://harvest.greenhouse.io/v1'

/**
 * Upper bound on per-application scorecard requests during a single getDocument call.
 * A candidate can have many applications (e.g. internal-transfer tracking); without a
 * cap, one document fetch could fan out into dozens of sequential requests. Mirrors the
 * Ashby connector's MAX_APPLICATIONS_FOR_FEEDBACK bound.
 */
const MAX_APPLICATIONS_FOR_SCORECARDS = 10

/** Concurrent per-application scorecard requests issued during one getDocument call. */
const SCORECARD_FETCH_CONCURRENCY = 5

/**
 * Greenhouse Harvest allows up to 500 candidates per page. We page through the
 * full list using the `page` query parameter and stop when the `Link` response
 * header no longer advertises a `rel="next"` relationship.
 *
 * `per_page` is deliberately constant across pages: `page` selects the n-th chunk
 * *of `per_page` records*, so shrinking it on a later page would slide the window
 * backwards and skip candidates.
 */
const CANDIDATES_PER_PAGE = 500

/**
 * Minutes of overlap subtracted from `lastSyncAt` when computing the incremental
 * `updated_after` window. Catches candidates whose `updated_at` lands fractionally
 * before the recorded sync boundary (clock skew, late-committed writes) at the
 * cost of re-listing a small number of recently-touched candidates.
 */
const INCREMENTAL_OVERLAP_MINUTES = 5
const MS_PER_MINUTE = 60 * 1000

interface GreenhouseUser {
  id?: number
  first_name?: string | null
  last_name?: string | null
  name?: string | null
  employee_id?: string | null
}

interface GreenhouseEmailAddress {
  value?: string
  type?: string
}

interface GreenhouseSource {
  id?: number
  public_name?: string | null
}

interface GreenhouseApplication {
  id?: number
  status?: string | null
  applied_at?: string | null
  last_activity_at?: string | null
  source?: GreenhouseSource | null
  recruiter?: GreenhouseUser | null
  coordinator?: GreenhouseUser | null
}

interface GreenhouseCandidate {
  id: number
  first_name?: string | null
  last_name?: string | null
  company?: string | null
  title?: string | null
  created_at?: string | null
  updated_at?: string | null
  last_activity?: string | null
  email_addresses?: GreenhouseEmailAddress[]
  tags?: string[]
  application_ids?: number[]
  applications?: GreenhouseApplication[]
  recruiter?: GreenhouseUser | null
  coordinator?: GreenhouseUser | null
}

interface GreenhouseActivityNote {
  id?: number
  created_at?: string | null
  body?: string | null
  user?: GreenhouseUser | null
  visibility?: string | null
}

interface GreenhouseActivityEmail {
  id?: number
  created_at?: string | null
  subject?: string | null
  body?: string | null
  to?: string | null
  from?: string | null
  user?: GreenhouseUser | null
}

interface GreenhouseActivityEvent {
  id?: number
  created_at?: string | null
  subject?: string | null
  body?: string | null
  user?: GreenhouseUser | null
}

interface GreenhouseActivityFeed {
  notes?: GreenhouseActivityNote[]
  emails?: GreenhouseActivityEmail[]
  activities?: GreenhouseActivityEvent[]
}

interface GreenhouseScorecardAttribute {
  name?: string | null
  type?: string | null
  note?: string | null
  rating?: string | null
}

interface GreenhouseScorecardQuestion {
  question?: string | null
  answer?: string | null
}

interface GreenhouseScorecard {
  id?: number
  interview?: string | null
  interviewer?: GreenhouseUser | null
  submitted_by?: GreenhouseUser | null
  submitted_at?: string | null
  interviewed_at?: string | null
  overall_recommendation?: string | null
  attributes?: GreenhouseScorecardAttribute[]
  questions?: GreenhouseScorecardQuestion[]
}

/**
 * Builds the HTTP Basic authorization header for Greenhouse Harvest. The API key
 * is used as the username with an empty password, base64-encoded as `apiKey:`.
 */
function buildAuthHeader(accessToken: string): string {
  return `Basic ${Buffer.from(`${accessToken}:`).toString('base64')}`
}

/**
 * Parses the RFC 5988 `Link` response header and returns true when a
 * `rel="next"` relationship is present, indicating another page exists.
 */
function hasNextPage(linkHeader: string | null): boolean {
  if (!linkHeader) return false
  return /;\s*rel\s*=\s*"?next"?/i.test(linkHeader)
}

/**
 * Builds a display name from a candidate's first and last name, falling back to
 * the candidate ID when both are missing.
 */
function candidateDisplayName(candidate: GreenhouseCandidate): string {
  const parts = [candidate.first_name, candidate.last_name]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(' ') : `Candidate ${candidate.id}`
}

/**
 * Computes the metadata-based content hash for a candidate. Both the listing stub
 * and `getDocument` use the same formula so the sync engine can detect changes
 * without downloading the deferred content.
 *
 * `last_activity` is mixed in alongside `updated_at` because the document body is
 * assembled from the activity feed and scorecards, and Greenhouse does not document
 * that appending a note, email, or scorecard advances `updated_at`. Both fields are
 * returned by the list and the single-candidate endpoints, so the stub and
 * `getDocument` always agree.
 */
function buildContentHash(candidate: GreenhouseCandidate): string {
  return `greenhouse:${candidate.id}:${candidate.updated_at ?? ''}:${candidate.last_activity ?? ''}`
}

/**
 * Resolves the source URL for a candidate in the Greenhouse recruiting UI.
 */
function buildSourceUrl(id: number): string {
  return `https://app.greenhouse.io/people/${id}`
}

/**
 * Resolves the recruiter, coordinator, and source for a candidate. Greenhouse
 * exposes these both at the candidate level and per-application; the candidate
 * level is preferred and the most-recent application is used as a fallback so
 * the tags are populated even when the candidate-level fields are empty.
 */
function resolveOwnership(candidate: GreenhouseCandidate): {
  recruiter?: string
  coordinator?: string
  source?: string
} {
  const applications = Array.isArray(candidate.applications) ? candidate.applications : []
  const latest = applications.reduce<GreenhouseApplication | undefined>((acc, app) => {
    if (!acc) return app
    const accTime = acc.applied_at ? Date.parse(acc.applied_at) : 0
    const appTime = app.applied_at ? Date.parse(app.applied_at) : 0
    return appTime >= accTime ? app : acc
  }, undefined)

  const recruiterName = userName(candidate.recruiter ?? latest?.recruiter)
  const coordinatorName = userName(candidate.coordinator ?? latest?.coordinator)
  const sourceName = latest?.source?.public_name?.trim()

  return {
    recruiter: recruiterName !== 'Unknown' ? recruiterName : undefined,
    coordinator: coordinatorName !== 'Unknown' ? coordinatorName : undefined,
    source: sourceName || undefined,
  }
}

/**
 * Builds the shared metadata block for a candidate, used by both the listing
 * stub and the fully-hydrated document.
 */
function buildMetadata(candidate: GreenhouseCandidate): Record<string, unknown> {
  const emails = (candidate.email_addresses ?? [])
    .map((e) => e.value?.trim())
    .filter((value): value is string => Boolean(value))

  const { recruiter, coordinator, source } = resolveOwnership(candidate)
  const applicationCount = Array.isArray(candidate.application_ids)
    ? candidate.application_ids.length
    : Array.isArray(candidate.applications)
      ? candidate.applications.length
      : 0

  return {
    candidateName: candidateDisplayName(candidate),
    company: candidate.company ?? undefined,
    title: candidate.title ?? undefined,
    emails,
    tags: Array.isArray(candidate.tags) ? candidate.tags : [],
    createdAt: candidate.created_at ?? undefined,
    updatedAt: candidate.updated_at ?? undefined,
    lastActivity: candidate.last_activity ?? undefined,
    recruiter,
    coordinator,
    source,
    applicationCount,
  }
}

/**
 * Creates a lightweight, content-deferred document stub from a candidate listing
 * entry. The real content is fetched lazily via `getDocument` for new or changed
 * candidates only.
 */
function candidateToStub(candidate: GreenhouseCandidate): ExternalDocument {
  return {
    externalId: String(candidate.id),
    title: candidateDisplayName(candidate),
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: buildSourceUrl(candidate.id),
    contentHash: buildContentHash(candidate),
    metadata: buildMetadata(candidate),
  }
}

/**
 * Formats a user's display name for inclusion in content lines.
 */
function userName(user?: GreenhouseUser | null): string {
  if (!user) return 'Unknown'
  if (user.name?.trim()) return user.name.trim()
  const parts = [user.first_name, user.last_name]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(' ') : 'Unknown'
}

/**
 * Renders a candidate's activity feed (notes, emails, and events) into plain text.
 */
function formatActivityFeed(feed: GreenhouseActivityFeed): string {
  const lines: string[] = []

  const notes = feed.notes ?? []
  if (notes.length > 0) {
    lines.push('--- Notes ---')
    for (const note of notes) {
      const body = htmlToPlainText(note.body ?? '').trim()
      if (!body) continue
      const when = note.created_at ? ` (${note.created_at})` : ''
      lines.push(`[${userName(note.user)}${when}] ${body}`)
    }
    lines.push('')
  }

  const activities = feed.activities ?? []
  if (activities.length > 0) {
    lines.push('--- Activities ---')
    for (const activity of activities) {
      const body = htmlToPlainText(activity.body ?? '').trim()
      const subject = activity.subject?.trim()
      const text = [subject, body].filter(Boolean).join(': ')
      if (!text) continue
      const when = activity.created_at ? ` (${activity.created_at})` : ''
      lines.push(`[${userName(activity.user)}${when}] ${text}`)
    }
    lines.push('')
  }

  const emails = feed.emails ?? []
  if (emails.length > 0) {
    lines.push('--- Emails ---')
    for (const email of emails) {
      const body = htmlToPlainText(email.body ?? '').trim()
      const subject = email.subject?.trim()
      if (!subject && !body) continue
      const when = email.created_at ? ` (${email.created_at})` : ''
      if (subject) lines.push(`[${userName(email.user)}${when}] Subject: ${subject}`)
      if (body) lines.push(body)
    }
    lines.push('')
  }

  return lines.join('\n').trim()
}

/**
 * Renders interview scorecards (recommendations, attribute ratings, and free-text
 * question feedback) into plain text.
 */
function formatScorecards(scorecards: GreenhouseScorecard[]): string {
  if (scorecards.length === 0) return ''

  const lines: string[] = ['--- Scorecards ---']

  for (const scorecard of scorecards) {
    const interview = scorecard.interview?.trim() || 'Interview'
    const reviewer = userName(scorecard.submitted_by ?? scorecard.interviewer)
    const when = scorecard.submitted_at ? ` (${scorecard.submitted_at})` : ''
    lines.push(`# ${interview} — ${reviewer}${when}`)

    if (scorecard.overall_recommendation?.trim()) {
      lines.push(`Overall recommendation: ${scorecard.overall_recommendation.trim()}`)
    }

    for (const attribute of scorecard.attributes ?? []) {
      const name = attribute.name?.trim()
      if (!name) continue
      const rating = attribute.rating?.trim()
      const note = htmlToPlainText(attribute.note ?? '').trim()
      const detail = [rating ? `rating: ${rating}` : '', note].filter(Boolean).join(' — ')
      lines.push(detail ? `- ${name}: ${detail}` : `- ${name}`)
    }

    for (const question of scorecard.questions ?? []) {
      const q = htmlToPlainText(question.question ?? '').trim()
      const a = htmlToPlainText(question.answer ?? '').trim()
      if (!q && !a) continue
      lines.push(q ? `Q: ${q}` : 'Q:')
      if (a) lines.push(`A: ${a}`)
    }

    lines.push('')
  }

  return lines.join('\n').trim()
}

/**
 * Assembles the full document content for a candidate from their profile header,
 * activity feed, and interview scorecards.
 */
function formatContent(
  candidate: GreenhouseCandidate,
  feed: GreenhouseActivityFeed,
  scorecards: GreenhouseScorecard[]
): string {
  const sections: string[] = []

  const header: string[] = [`Candidate: ${candidateDisplayName(candidate)}`]
  if (candidate.title?.trim()) header.push(`Title: ${candidate.title.trim()}`)
  if (candidate.company?.trim()) header.push(`Company: ${candidate.company.trim()}`)
  const emails = (candidate.email_addresses ?? [])
    .map((e) => e.value?.trim())
    .filter((value): value is string => Boolean(value))
  if (emails.length > 0) header.push(`Email: ${emails.join(', ')}`)
  if (Array.isArray(candidate.tags) && candidate.tags.length > 0) {
    header.push(`Tags: ${candidate.tags.join(', ')}`)
  }
  sections.push(header.join('\n'))

  const activity = formatActivityFeed(feed)
  if (activity) sections.push(activity)

  const scorecardText = formatScorecards(scorecards)
  if (scorecardText) sections.push(scorecardText)

  return sections.join('\n\n').trim()
}

/**
 * Fetches a single candidate by ID. Returns null on 404.
 */
async function fetchCandidate(
  accessToken: string,
  id: string
): Promise<GreenhouseCandidate | null> {
  const response = await fetchWithRetry(`${GREENHOUSE_API_BASE}/candidates/${id}`, {
    method: 'GET',
    headers: { Authorization: buildAuthHeader(accessToken), Accept: 'application/json' },
  })

  if (!response.ok) {
    if (response.status === 404) return null
    throw new Error(`Failed to fetch Greenhouse candidate: ${response.status}`)
  }

  return (await response.json()) as GreenhouseCandidate
}

/**
 * Fetches a candidate's activity feed. Returns an empty feed when the endpoint
 * 404s so the candidate's profile header still produces content.
 */
async function fetchActivityFeed(accessToken: string, id: string): Promise<GreenhouseActivityFeed> {
  const response = await fetchWithRetry(`${GREENHOUSE_API_BASE}/candidates/${id}/activity_feed`, {
    method: 'GET',
    headers: { Authorization: buildAuthHeader(accessToken), Accept: 'application/json' },
  })

  if (!response.ok) {
    if (response.status === 404) return {}
    throw new Error(`Failed to fetch Greenhouse activity feed: ${response.status}`)
  }

  return (await response.json()) as GreenhouseActivityFeed
}

/**
 * Fetches the scorecards for a single application.
 *
 * `complete` is false only when a transient failure hid feedback that still exists.
 * Harvest's error table lists both `404 Not Found -- Resource not found` and
 * `403 Forbidden -- You don't have access to that record`, and neither clears on a
 * retry: the application is gone, or this API key is permanently not permitted to
 * read its scorecards. Both are therefore a settled absence — marking them partial
 * would re-hydrate the candidate on every sync forever without ever converging.
 * A rate-limiting 403 never reaches here: `fetchWithRetry` only treats a 403 as
 * retryable when the response headers prove a rate limit, and a retry exhaustion
 * throws into the catch below as the transient failure it is.
 */
async function fetchScorecardsForApplication(
  accessToken: string,
  applicationId: number
): Promise<{ scorecards: GreenhouseScorecard[]; complete: boolean }> {
  try {
    const response = await fetchWithRetry(
      `${GREENHOUSE_API_BASE}/applications/${applicationId}/scorecards`,
      {
        method: 'GET',
        headers: { Authorization: buildAuthHeader(accessToken), Accept: 'application/json' },
      }
    )

    if (!response.ok) {
      if (response.status === 404 || response.status === 403) {
        return { scorecards: [], complete: true }
      }
      throw new Error(`Failed to fetch Greenhouse scorecards: ${response.status}`)
    }

    const data = (await response.json()) as GreenhouseScorecard[]
    return { scorecards: Array.isArray(data) ? data : [], complete: true }
  } catch (error) {
    logger.warn('Failed to fetch scorecards for application', {
      applicationId,
      error: toError(error).message,
    })
    return { scorecards: [], complete: false }
  }
}

/**
 * Fetches all scorecards across a candidate's applications, in bounded-concurrency
 * batches. Application order is preserved so the rendered content is stable across
 * syncs.
 *
 * `complete` is false only when a transient failure hid feedback that still
 * exists. The deliberate {@link MAX_APPLICATIONS_FOR_SCORECARDS} bound keeps it
 * true: it truncates identically on every run, so marking it partial would
 * re-hydrate the same candidate forever without ever converging.
 */
async function fetchScorecards(
  accessToken: string,
  applicationIds: number[]
): Promise<{ scorecards: GreenhouseScorecard[]; complete: boolean }> {
  const bounded = applicationIds.slice(0, MAX_APPLICATIONS_FOR_SCORECARDS)
  let complete = true
  if (bounded.length < applicationIds.length) {
    logger.warn('Candidate exceeds the scorecard application bound; later applications skipped', {
      applications: applicationIds.length,
      fetched: bounded.length,
    })
  }

  const scorecards: GreenhouseScorecard[] = []
  for (let i = 0; i < bounded.length; i += SCORECARD_FETCH_CONCURRENCY) {
    const batch = bounded.slice(i, i + SCORECARD_FETCH_CONCURRENCY)
    const results = await Promise.all(
      batch.map((applicationId) => fetchScorecardsForApplication(accessToken, applicationId))
    )
    for (const result of results) {
      scorecards.push(...result.scorecards)
      if (!result.complete) complete = false
    }
  }

  return { scorecards, complete }
}

/**
 * Computes the `updated_after` value for an incremental sync, subtracting a small
 * overlap from the last sync timestamp. Returns undefined for full syncs.
 */
function computeUpdatedAfter(lastSyncAt: Date | undefined): string | undefined {
  if (!lastSyncAt) return undefined
  const since = new Date(lastSyncAt.getTime() - INCREMENTAL_OVERLAP_MINUTES * MS_PER_MINUTE)
  return since.toISOString()
}

export const greenhouseConnector: ConnectorConfig = {
  ...greenhouseConnectorMeta,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>,
    lastSyncAt?: Date
  ): Promise<ExternalDocumentList> => {
    const maxCandidates = sourceConfig.maxCandidates ? Number(sourceConfig.maxCandidates) : 0
    const parsedPage = cursor ? Number(cursor) : 1
    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.floor(parsedPage) : 1
    const updatedAfter = computeUpdatedAfter(lastSyncAt)
    const jobId = typeof sourceConfig.jobId === 'string' ? sourceConfig.jobId.trim() : ''
    const createdAfter =
      typeof sourceConfig.createdAfter === 'string' ? sourceConfig.createdAfter.trim() : ''
    const createdBefore =
      typeof sourceConfig.createdBefore === 'string' ? sourceConfig.createdBefore.trim() : ''

    const prevFetched = (syncContext?.totalDocsFetched as number) ?? 0
    const remaining = maxCandidates > 0 ? Math.max(0, maxCandidates - prevFetched) : 0

    const queryParams = new URLSearchParams({
      per_page: String(CANDIDATES_PER_PAGE),
      page: String(page),
    })
    if (updatedAfter) queryParams.set('updated_after', updatedAfter)
    if (jobId) queryParams.set('job_id', jobId)
    if (createdAfter) queryParams.set('created_after', createdAfter)
    if (createdBefore) queryParams.set('created_before', createdBefore)

    const url = `${GREENHOUSE_API_BASE}/candidates?${queryParams.toString()}`

    logger.info('Listing Greenhouse candidates', {
      page,
      perPage: CANDIDATES_PER_PAGE,
      incremental: Boolean(updatedAfter),
    })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: { Authorization: buildAuthHeader(accessToken), Accept: 'application/json' },
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error('Failed to list Greenhouse candidates', {
        status: response.status,
        error: errorText.slice(0, 500),
      })
      throw new Error(`Failed to list Greenhouse candidates: ${response.status}`)
    }

    const data = (await response.json()) as GreenhouseCandidate[]
    const candidates = Array.isArray(data) ? data : []
    const linkHasNext = hasNextPage(response.headers.get('link'))

    let pageCandidates = candidates
    if (maxCandidates > 0 && pageCandidates.length > remaining) {
      pageCandidates = pageCandidates.slice(0, remaining)
    }

    const documents = pageCandidates.map(candidateToStub)

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = maxCandidates > 0 && totalFetched >= maxCandidates
    const hasMore = !hitLimit && linkHasNext

    /**
     * Deletion reconciliation hard-deletes every stored document missing from the
     * listing, so the cap flag must be raised only when candidates that still exist
     * were genuinely left unlisted: either this page was trimmed to fit the cap, or
     * the cap stopped paging while Greenhouse still advertises a `rel="next"` page.
     * A run that reaches the cap exactly as the source is exhausted is a complete
     * listing and must stay reconcilable.
     */
    if (syncContext && (pageCandidates.length < candidates.length || (hitLimit && linkHasNext))) {
      syncContext.listingCapped = true
    }

    return {
      documents,
      nextCursor: hasMore ? String(page + 1) : undefined,
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

      const candidate = await fetchCandidate(accessToken, externalId)
      if (!candidate) return null

      const applicationIds = Array.isArray(candidate.application_ids)
        ? candidate.application_ids
        : []

      const [feed, { scorecards, complete }] = await Promise.all([
        fetchActivityFeed(accessToken, externalId),
        fetchScorecards(accessToken, applicationIds),
      ])

      const content = formatContent(candidate, feed, scorecards)
      if (!content.trim()) return null

      /**
       * A failed scorecard fetch yields usable but incomplete content. Storing it
       * under the canonical hash would freeze the gap in place until the candidate
       * itself changes, so a partial marker is appended instead: it never matches
       * the list stub's hash, so the next sync re-hydrates and self-heals once
       * Greenhouse responds.
       */
      const contentHash = complete
        ? buildContentHash(candidate)
        : `${buildContentHash(candidate)}:partial`

      return {
        externalId: String(candidate.id),
        title: candidateDisplayName(candidate),
        content,
        contentDeferred: false,
        mimeType: 'text/plain',
        sourceUrl: buildSourceUrl(candidate.id),
        contentHash,
        metadata: buildMetadata(candidate),
      }
    } catch (error) {
      /**
       * `fetchCandidate` already returns null on a 404, so a thrown error here is
       * transient (429, 5xx, network) and must propagate for the engine to record a
       * failed row instead of dropping a candidate that still exists.
       */
      logger.warn('Failed to get Greenhouse candidate', {
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
    const maxCandidates = sourceConfig.maxCandidates as string | undefined
    if (maxCandidates && (Number.isNaN(Number(maxCandidates)) || Number(maxCandidates) < 0)) {
      return { valid: false, error: 'Max candidates must be a non-negative number' }
    }

    const jobId = sourceConfig.jobId
    if (typeof jobId === 'string' && jobId.trim() && !/^\d+$/.test(jobId.trim())) {
      return { valid: false, error: 'Job ID must be a numeric Greenhouse job ID (e.g. 123456)' }
    }

    const timestampFields = [
      ['createdAfter', 'Created After'],
      ['createdBefore', 'Created Before'],
    ] as const
    for (const [field, label] of timestampFields) {
      const value = sourceConfig[field]
      if (typeof value === 'string' && value.trim() && Number.isNaN(Date.parse(value.trim()))) {
        return {
          valid: false,
          error: `${label} must be a valid ISO 8601 timestamp (e.g. 2024-01-01T00:00:00Z)`,
        }
      }
    }

    try {
      const response = await fetchWithRetry(
        `${GREENHOUSE_API_BASE}/candidates?per_page=1`,
        {
          method: 'GET',
          headers: { Authorization: buildAuthHeader(accessToken), Accept: 'application/json' },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return {
          valid: false,
          error: `Greenhouse access failed: ${response.status}${errorText ? ` — ${errorText.slice(0, 200)}` : ''}`,
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

    const textFields = [
      'candidateName',
      'company',
      'title',
      'recruiter',
      'coordinator',
      'source',
    ] as const
    for (const field of textFields) {
      const value = metadata[field]
      if (typeof value === 'string' && value.trim()) {
        result[field] = value.trim()
      }
    }

    if (typeof metadata.applicationCount === 'number' && metadata.applicationCount >= 0) {
      result.applicationCount = metadata.applicationCount
    }

    const dateFields = ['updatedAt', 'lastActivity'] as const
    for (const field of dateFields) {
      const parsed = parseTagDate(metadata[field])
      if (parsed) result[field] = parsed
    }

    return result
  },
}
