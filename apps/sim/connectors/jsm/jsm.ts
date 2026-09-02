import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { AtlassianSiteNotAccessibleError } from '@/lib/atlassian/discovery'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { jsmConnectorMeta } from '@/connectors/jsm/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  htmlToPlainText,
  isListingScopeUnavailableError,
  listingRequestError,
  parseTagDate,
} from '@/connectors/utils'
import { extractAdfText, getJiraCloudId } from '@/tools/jira/utils'
import { getJsmApiBaseUrl, getJsmHeaders } from '@/tools/jsm/utils'

const logger = createLogger('JsmConnector')

const PAGE_SIZE = 50

/**
 * Allowed `requestStatus` filter values for `GET /rest/servicedeskapi/request`.
 * When omitted, the JSM API defaults to `ALL_REQUESTS`.
 */
const VALID_REQUEST_STATUS = ['OPEN_REQUESTS', 'CLOSED_REQUESTS', 'ALL_REQUESTS'] as const
type JsmRequestStatus = (typeof VALID_REQUEST_STATUS)[number]

/**
 * Allowed `requestOwnership` filter values for `GET /rest/servicedeskapi/request`.
 *
 * This param scopes results to the OAuth user's relationship to each request —
 * `GET /request` is always relative to the executing user, never a service-desk-wide
 * dump. When omitted the API defaults to the combination `OWNED_REQUESTS`,
 * `PARTICIPATED_REQUESTS`, and `ALL_ORGANIZATIONS`; `ALL_REQUESTS` is documented as
 * "returns all customer requests" — the widest of the strategies — so it is the
 * connector default. Atlassian marks it deprecated because the set it unions may
 * change as strategies are added, not because it was narrowed, so it is kept until a
 * single non-deprecated value covers the same breadth.
 *
 * `ORGANIZATION` and `APPROVER` are omitted: the first is only meaningful alongside
 * an `organizationId` the connector does not collect, and the second is already
 * inside what `ALL_REQUESTS` returns.
 */
const VALID_REQUEST_OWNERSHIP = [
  'OWNED_REQUESTS',
  'PARTICIPATED_REQUESTS',
  'ALL_ORGANIZATIONS',
  'ALL_REQUESTS',
] as const
type JsmRequestOwnership = (typeof VALID_REQUEST_OWNERSHIP)[number]

/**
 * Which comments to include in synced documents.
 */
const VALID_COMMENT_SCOPE = ['none', 'public', 'all'] as const
type JsmCommentScope = (typeof VALID_COMMENT_SCOPE)[number]

/**
 * A JSM date object as returned by the Service Desk REST API. The same shape is
 * used for `createdDate`, `currentStatus.statusDate`, and comment `created`.
 */
interface JsmDate {
  iso8601?: string
  friendly?: string
  epochMillis?: number
}

/**
 * Subset of a JSM customer request returned by `GET /request` and
 * `GET /request/{issueIdOrKey}`. Only the fields the connector reads are typed.
 */
interface JsmRequest {
  issueId?: string
  issueKey?: string
  summary?: string
  requestTypeId?: string
  serviceDeskId?: string
  createdDate?: JsmDate
  currentStatus?: {
    status?: string
    statusCategory?: string
    statusDate?: JsmDate
  }
  reporter?: {
    displayName?: string
    emailAddress?: string
  }
  requestFieldValues?: Array<{
    fieldId?: string
    label?: string
    value?: unknown
    renderedValue?: unknown
  }>
  _links?: {
    web?: string
  }
}

/**
 * A single comment on a JSM request. The JSM API returns the comment `body` as a
 * plain string containing Jira wiki markup (not an ADF document), so no rich-text
 * extraction is required.
 */
interface JsmComment {
  id?: string
  body?: string
  public?: boolean
  author?: {
    displayName?: string
  }
  created?: JsmDate
}

/**
 * Paginated envelope shared by every JSM Service Desk list endpoint.
 */
interface JsmPage<T> {
  values?: T[]
  size?: number
  isLastPage?: boolean
}

/**
 * Reads the resolved sync options off the raw `sourceConfig`, normalizing
 * enum-like fields to their valid set and clamping the numeric cap. Centralized
 * so `listDocuments`, `getDocument`, and `validateConfig` agree on defaults.
 */
function resolveOptions(sourceConfig: Record<string, unknown>): {
  requestStatus: JsmRequestStatus
  requestOwnership: JsmRequestOwnership
  requestTypeId: string
  searchTerm: string
  commentScope: JsmCommentScope
  maxRequests: number
} {
  const requestStatus = VALID_REQUEST_STATUS.includes(
    sourceConfig.requestStatus as JsmRequestStatus
  )
    ? (sourceConfig.requestStatus as JsmRequestStatus)
    : 'ALL_REQUESTS'

  const requestOwnership = VALID_REQUEST_OWNERSHIP.includes(
    sourceConfig.requestOwnership as JsmRequestOwnership
  )
    ? (sourceConfig.requestOwnership as JsmRequestOwnership)
    : 'ALL_REQUESTS'

  const commentScope = VALID_COMMENT_SCOPE.includes(sourceConfig.comments as JsmCommentScope)
    ? (sourceConfig.comments as JsmCommentScope)
    : 'public'

  const requestTypeId =
    typeof sourceConfig.requestTypeId === 'string' ? sourceConfig.requestTypeId.trim() : ''
  const searchTerm =
    typeof sourceConfig.searchTerm === 'string' ? sourceConfig.searchTerm.trim() : ''

  const parsedMax = sourceConfig.maxRequests ? Number(sourceConfig.maxRequests) : 0
  const maxRequests = Number.isFinite(parsedMax) && parsedMax > 0 ? Math.floor(parsedMax) : 0

  return { requestStatus, requestOwnership, requestTypeId, searchTerm, commentScope, maxRequests }
}

/**
 * Extracts a plain-text value for a given request field id (e.g. `summary`,
 * `description`) from a request's `requestFieldValues`.
 *
 * `renderedValue.html` is preferred when the API supplies it: rich-text fields
 * come back in `value` as raw Jira wiki markup (`I need a new *mouse*`) or as an
 * ADF document, and the rendered HTML is the only form that preserves list,
 * table, and link text without markup noise. Falls back to `value` as a string
 * or via ADF extraction.
 */
function getFieldText(request: JsmRequest, fieldId: string): string {
  const field = request.requestFieldValues?.find((f) => f.fieldId === fieldId)
  if (!field) return ''

  const rendered = field.renderedValue
  if (rendered && typeof rendered === 'object') {
    const html = (rendered as { html?: unknown }).html
    if (typeof html === 'string' && html.trim()) {
      const text = htmlToPlainText(html).trim()
      if (text) return text
    }
  }

  const { value } = field
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const adf = extractAdfText(value)
    if (adf) return adf
  }
  return ''
}

/**
 * Resolves a request's summary. `CustomerRequestDTO.summary` is always present,
 * whereas `requestFieldValues` omits fields hidden on the request-type form — so
 * the top-level field is preferred and the field value is only a fallback.
 */
function getSummary(request: JsmRequest): string {
  const top = typeof request.summary === 'string' ? request.summary.trim() : ''
  if (top) return top
  return getFieldText(request, 'summary').trim()
}

/**
 * Resolves the best available "change indicator" timestamp for a request.
 *
 * The JSM list endpoint does NOT return an updated/last-modified field — only
 * `createdDate` and `currentStatus.statusDate` are present. We use
 * `statusDate` (the time the request last changed status) when available, and
 * fall back to `createdDate`. This is the change signal encoded into the
 * contentHash. Note: edits that do not change status (e.g. a new comment) are
 * not reflected here, so such changes may not trigger a re-sync.
 */
function getChangeIndicator(request: JsmRequest): string {
  const statusDate = request.currentStatus?.statusDate
  if (statusDate?.epochMillis != null) return String(statusDate.epochMillis)
  if (statusDate?.iso8601) return statusDate.iso8601
  const created = request.createdDate
  if (created?.epochMillis != null) return String(created.epochMillis)
  if (created?.iso8601) return created.iso8601
  return ''
}

/**
 * Builds a stub ExternalDocument from a request returned by the list endpoint.
 * Content is deferred — description and comments require a per-request API call
 * fetched lazily in `getDocument`. The contentHash is metadata-only so it is
 * identical whether produced here or in `getDocument`.
 */
function requestToStub(request: JsmRequest, domain: string): ExternalDocument {
  const issueId = String(request.issueId ?? '')
  const issueKey = request.issueKey ?? issueId
  const summary = getSummary(request) || 'Untitled'
  const status = request.currentStatus?.status

  const bareDomain = domain
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')

  return {
    externalId: issueId,
    title: `${issueKey}: ${summary}`,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: request._links?.web || `https://${bareDomain}/browse/${issueKey}`,
    contentHash: `jsm:${issueId}:${getChangeIndicator(request)}`,
    metadata: {
      issueKey,
      requestTypeId: request.requestTypeId,
      serviceDeskId: request.serviceDeskId,
      status,
      reporter: request.reporter?.displayName,
      created: request.createdDate?.iso8601,
      /**
       * The list endpoint has no true "last updated" field; `statusDate` is the
       * closest available signal (time of last status change). Mapped to the
       * `updated` tag and documented as such.
       */
      statusDate: request.currentStatus?.statusDate?.iso8601,
    },
  }
}

/**
 * Renders a readable plain-text document from a fully-fetched request and its
 * comments. Includes summary, description, reporter, status, and comment thread.
 */
function buildContent(request: JsmRequest, comments: JsmComment[]): string {
  const parts: string[] = []

  const summary = getSummary(request)
  if (summary) parts.push(summary)

  const description = getFieldText(request, 'description')
  if (description) parts.push(description)

  const status = request.currentStatus?.status
  if (status) parts.push(`Status: ${status}`)

  const reporter = request.reporter?.displayName
  if (reporter) parts.push(`Reporter: ${reporter}`)

  if (comments.length > 0) {
    parts.push('Comments:')
    for (const comment of comments) {
      const body = (comment.body ?? '').trim()
      if (!body) continue
      const author = comment.author?.displayName
      parts.push(author ? `${author}: ${body}` : body)
    }
  }

  return parts.join('\n\n').trim()
}

/**
 * Resolves and caches the Jira cloud ID for a domain across a sync run.
 */
async function resolveCloudId(
  domain: string,
  accessToken: string,
  syncContext?: Record<string, unknown>
): Promise<string> {
  const cached = syncContext?.cloudId as string | undefined
  if (cached) return cached
  const cloudId = await getJiraCloudId(domain, accessToken)
  if (syncContext) syncContext.cloudId = cloudId
  return cloudId
}

/**
 * Resolves a configured service desk identifier to the numeric service desk id.
 *
 * `GET /servicedesk/{serviceDeskId}` accepts either the numeric id or a project
 * key, but the `serviceDeskId` filter on `GET /request` is typed `integer` — a
 * project key entered in advanced mode would validate and then silently match
 * nothing. Resolve it once per sync and cache it on `syncContext`.
 */
async function resolveServiceDeskId(
  baseUrl: string,
  accessToken: string,
  configuredId: string,
  syncContext?: Record<string, unknown>
): Promise<string> {
  const trimmed = configuredId.trim()
  if (/^\d+$/.test(trimmed)) return trimmed

  const cached = syncContext?.serviceDeskNumericId as string | undefined
  if (cached) return cached

  const response = await fetchWithRetry(`${baseUrl}/servicedesk/${encodeURIComponent(trimmed)}`, {
    method: 'GET',
    headers: getJsmHeaders(accessToken),
  })

  if (!response.ok) {
    throw new Error(`Failed to resolve service desk "${trimmed}": ${response.status}`)
  }

  const data = (await response.json()) as { id?: string }
  const resolved = data.id ? String(data.id) : ''
  if (!resolved) {
    throw new Error(`Service desk "${trimmed}" returned no id`)
  }

  if (syncContext) syncContext.serviceDeskNumericId = resolved
  return resolved
}

/**
 * Upper bound on comments pulled into a single document. A pathological request
 * thread must not fan out into unbounded pagination or an unbounded in-memory
 * array; the cap is logged when it engages.
 */
const MAX_COMMENTS_PER_REQUEST = 500

/**
 * Fetches comments for a request, following offset pagination until the API
 * signals `isLastPage`. When `publicOnly` is true the `public=true` filter is
 * applied so internal/agent-only comments are excluded.
 *
 * Throws on a failed page rather than returning what it has. The document's
 * `contentHash` is metadata-only, so a thread cut short by a transient error
 * would be indexed as complete and never re-fetched; throwing lets the sync
 * engine record the document as failed and retry it on the next run. The
 * {@link MAX_COMMENTS_PER_REQUEST} cut is deliberate and deterministic instead —
 * retrying would land in exactly the same place — so it only warns.
 */
async function fetchComments(
  baseUrl: string,
  accessToken: string,
  issueIdOrKey: string,
  publicOnly: boolean
): Promise<JsmComment[]> {
  const comments: JsmComment[] = []
  let start = 0

  while (true) {
    const params = new URLSearchParams({
      start: String(start),
      limit: String(PAGE_SIZE),
    })
    /**
     * The JSM comment endpoint exposes `public` and `internal` as independent
     * inclusion filters that both default to `true`. Requesting public-only
     * therefore requires explicitly disabling `internal` — passing `public=true`
     * alone would still return agent-only/internal comments.
     */
    if (publicOnly) {
      params.append('public', 'true')
      params.append('internal', 'false')
    }
    const url = `${baseUrl}/request/${encodeURIComponent(issueIdOrKey)}/comment?${params.toString()}`

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: getJsmHeaders(accessToken),
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch JSM comments for ${issueIdOrKey}: ${response.status}`)
    }

    const data = (await response.json()) as JsmPage<JsmComment>
    const values = data.values ?? []
    comments.push(...values)

    if (data.isLastPage || values.length === 0) break

    if (comments.length >= MAX_COMMENTS_PER_REQUEST) {
      logger.warn('Truncating JSM comment thread at cap', {
        issueIdOrKey,
        cap: MAX_COMMENTS_PER_REQUEST,
      })
      break
    }

    start += values.length
  }

  return comments
}

export const jsmConnector: ConnectorConfig = {
  ...jsmConnectorMeta,

  isListingScopeUnavailableError: (error) =>
    isListingScopeUnavailableError(error) || error instanceof AtlassianSiteNotAccessibleError,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const domain = sourceConfig.domain as string
    const serviceDeskId = sourceConfig.serviceDeskId as string

    if (!domain || !serviceDeskId) {
      throw new Error('Domain and service desk ID are required')
    }

    const { requestStatus, requestOwnership, requestTypeId, searchTerm, maxRequests } =
      resolveOptions(sourceConfig)

    const cloudId = await resolveCloudId(domain, accessToken, syncContext)
    const baseUrl = getJsmApiBaseUrl(cloudId)

    /**
     * `start|collected` is encoded in the cursor so the maxRequests cap holds
     * across pages even if syncContext is not threaded through by the caller.
     */
    let start = 0
    let collectedSoFar = (syncContext?.collectedCount as number | undefined) ?? 0
    if (cursor) {
      const sep = cursor.indexOf('|')
      if (sep > 0) {
        const parsedStart = Number(cursor.slice(0, sep))
        const parsedCount = Number(cursor.slice(sep + 1))
        if (Number.isFinite(parsedStart) && parsedStart >= 0) start = parsedStart
        if (Number.isFinite(parsedCount) && parsedCount >= 0) collectedSoFar = parsedCount
      } else {
        const parsedStart = Number(cursor)
        if (Number.isFinite(parsedStart) && parsedStart >= 0) start = parsedStart
      }
    }

    const remaining = maxRequests > 0 ? Math.max(0, maxRequests - collectedSoFar) : PAGE_SIZE
    if (maxRequests > 0 && remaining === 0) {
      return { documents: [], hasMore: false }
    }

    const resolvedServiceDeskId = await resolveServiceDeskId(
      baseUrl,
      accessToken,
      serviceDeskId,
      syncContext
    )

    const params = new URLSearchParams({
      serviceDeskId: resolvedServiceDeskId,
      requestStatus,
      start: String(start),
      limit: String(Math.min(PAGE_SIZE, remaining)),
    })
    params.append('requestOwnership', requestOwnership)
    if (requestTypeId) params.append('requestTypeId', requestTypeId)
    if (searchTerm) params.append('searchTerm', searchTerm)

    const url = `${baseUrl}/request?${params.toString()}`

    logger.info('Listing JSM requests', {
      serviceDeskId,
      requestStatus,
      requestOwnership,
      hasCursor: Boolean(cursor),
    })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: getJsmHeaders(accessToken),
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to list JSM requests', { status: response.status, error: errorText })
      throw listingRequestError('Failed to list JSM requests', response.status)
    }

    const data = (await response.json()) as JsmPage<JsmRequest>
    const requests = data.values ?? []

    const documents = requests.map((request) => requestToStub(request, domain))

    const newCollected = collectedSoFar + requests.length
    if (syncContext) syncContext.collectedCount = newCollected

    const reachedCap = maxRequests > 0 && newCollected >= maxRequests

    /**
     * When `maxRequests` truncates the listing before the source is exhausted,
     * flag the run as capped so the sync engine skips deletion reconciliation —
     * otherwise unseen requests beyond the cap would be deleted on every sync.
     * Reaching the cap exactly as the source runs out (`isLastPage`) is not a
     * truncation, so it must still reconcile.
     */
    if (reachedCap && !data.isLastPage && syncContext) {
      syncContext.listingCapped = true
    }

    const hasMore = !data.isLastPage && requests.length > 0 && !reachedCap
    const nextStart = start + requests.length

    return {
      documents,
      nextCursor: hasMore ? `${nextStart}|${newCollected}` : undefined,
      hasMore,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocument | null> => {
    const domain = sourceConfig.domain as string
    const { commentScope } = resolveOptions(sourceConfig)
    const cloudId = await resolveCloudId(domain, accessToken, syncContext)
    const baseUrl = getJsmApiBaseUrl(cloudId)

    /**
     * No `expand` is requested: `summary`, `requestFieldValues`, `currentStatus`,
     * `reporter`, and `_links` are all returned by default. `expand=status`
     * would only add the full status-transition history, which is unused.
     */
    const requestUrl = `${baseUrl}/request/${encodeURIComponent(externalId)}`
    const response = await fetchWithRetry(requestUrl, {
      method: 'GET',
      headers: getJsmHeaders(accessToken),
    })

    /**
     * The JSM REST docs document 404 as "Returned if the customer request does not
     * exist" and 403 as "Returned if the user does not have permission to complete
     * this request" — for a sync credential both amount to absence, since the
     * connector can never widen its own visibility. A 401 ("Returned if the user is
     * not logged in") is an invalid/expired token: a whole-sync fault that must
     * surface as a failed document rather than silently dropping every request.
     */
    if (!response.ok) {
      if (response.status === 404) return null
      if (response.status === 403) {
        logger.warn('Access denied fetching JSM request', { externalId, status: response.status })
        return null
      }
      throw new Error(`Failed to get JSM request: ${response.status}`)
    }

    const request = (await response.json()) as JsmRequest

    const comments =
      commentScope === 'none'
        ? []
        : await fetchComments(baseUrl, accessToken, externalId, commentScope === 'public')

    const stub = requestToStub(request, domain)
    const content = buildContent(request, comments)

    return {
      ...stub,
      content,
      contentDeferred: false,
    }
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const domain = sourceConfig.domain as string
    const serviceDeskId = sourceConfig.serviceDeskId as string

    if (!domain || !serviceDeskId) {
      return { valid: false, error: 'Domain and service desk ID are required' }
    }

    if (sourceConfig.maxRequests) {
      const max = Number(sourceConfig.maxRequests)
      if (Number.isNaN(max) || max <= 0) {
        return { valid: false, error: 'Max requests must be a positive number' }
      }
    }

    /**
     * `requestTypeId` is typed `integer` on `GET /request`; a non-numeric value
     * would be rejected mid-sync rather than at configuration time.
     */
    const requestTypeId =
      typeof sourceConfig.requestTypeId === 'string' ? sourceConfig.requestTypeId.trim() : ''
    if (requestTypeId && !/^\d+$/.test(requestTypeId)) {
      return { valid: false, error: 'Request type ID must be a number' }
    }

    try {
      const cloudId = await getJiraCloudId(domain, accessToken, VALIDATE_RETRY_OPTIONS)
      const baseUrl = getJsmApiBaseUrl(cloudId)
      const url = `${baseUrl}/servicedesk/${encodeURIComponent(serviceDeskId.trim())}`

      const response = await fetchWithRetry(
        url,
        {
          method: 'GET',
          headers: getJsmHeaders(accessToken),
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        if (response.status === 404) {
          return { valid: false, error: `Service desk "${serviceDeskId}" not found` }
        }
        if (response.status === 401 || response.status === 403) {
          return {
            valid: false,
            error: 'Access denied. Check the connected account has access to this service desk.',
          }
        }
        const errorText = await response.text()
        return { valid: false, error: `Failed to validate: ${response.status} - ${errorText}` }
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: toError(error).message || 'Failed to validate configuration' }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.status === 'string') result.status = metadata.status
    if (typeof metadata.requestTypeId === 'string') result.requestTypeId = metadata.requestTypeId
    if (typeof metadata.reporter === 'string') result.reporter = metadata.reporter

    const created = parseTagDate(metadata.created)
    if (created) result.created = created

    /**
     * The list endpoint exposes no true last-updated field; `statusDate` (time
     * of last status change) is the closest available signal and surfaces under
     * the "Last Status Change" tag.
     */
    const statusDate = parseTagDate(metadata.statusDate)
    if (statusDate) result.updated = statusDate

    return result
  },
}
