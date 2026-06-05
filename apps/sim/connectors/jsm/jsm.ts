import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { JiraServiceManagementIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseTagDate } from '@/connectors/utils'
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
 * This param scopes results to the OAuth user's relationship to each request. When
 * omitted, the JSM API defaults to `OWNED_REQUESTS` — i.e. only requests the
 * authenticated user reported. For a knowledge-base sync the user almost always
 * wants every request in the service desk, so the connector defaults this to
 * `ALL_REQUESTS` (which the JSM API treats as "owned + participated") rather than
 * relying on the API's narrower default.
 */
const VALID_REQUEST_OWNERSHIP = ['OWNED_REQUESTS', 'PARTICIPATED_REQUESTS', 'ALL_REQUESTS'] as const
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
 * `description`) from a request's `requestFieldValues`. The JSM API returns
 * `value` either as a plain string (wiki markup) or, for some rich-text fields,
 * as an ADF document — both are handled.
 */
function getFieldText(request: JsmRequest, fieldId: string): string {
  const field = request.requestFieldValues?.find((f) => f.fieldId === fieldId)
  if (!field) return ''
  const { value } = field
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const adf = extractAdfText(value)
    if (adf) return adf
  }
  return ''
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
  const summary = getFieldText(request, 'summary') || 'Untitled'
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

  const summary = getFieldText(request, 'summary')
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
 * Fetches comments for a request, following offset pagination until the API
 * signals `isLastPage`. When `publicOnly` is true the `public=true` filter is
 * applied so internal/agent-only comments are excluded.
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
      logger.warn('Failed to fetch JSM comments', {
        issueIdOrKey,
        status: response.status,
      })
      break
    }

    const data = (await response.json()) as JsmPage<JsmComment>
    const values = data.values ?? []
    comments.push(...values)

    if (data.isLastPage || values.length === 0) break
    start += values.length
  }

  return comments
}

export const jsmConnector: ConnectorConfig = {
  id: 'jsm',
  name: 'Jira Service Management',
  description: 'Sync service desk requests from Jira Service Management into your knowledge base',
  version: '1.0.0',
  icon: JiraServiceManagementIcon,

  auth: {
    mode: 'oauth',
    provider: 'jira',
    requiredScopes: [
      'read:servicedesk:jira-service-management',
      'read:request:jira-service-management',
      'read:request.comment:jira-service-management',
      'read:request.status:jira-service-management',
      /**
       * Requests embed a `reporter` user object whose `displayName` is surfaced
       * in document content and the Reporter tag. Atlassian only populates
       * embedded user data when the user-read scope is granted, so request it
       * here. Present in the `jira` OAuth provider config as `read:jira-user`.
       */
      'read:jira-user',
      'offline_access',
    ],
  },

  configFields: [
    {
      id: 'domain',
      title: 'Jira Domain',
      type: 'short-input',
      placeholder: 'yoursite.atlassian.net',
      required: true,
    },
    {
      id: 'serviceDeskSelector',
      title: 'Service Desk',
      type: 'selector',
      selectorKey: 'jsm.serviceDesks',
      canonicalParamId: 'serviceDeskId',
      mode: 'basic',
      dependsOn: ['domain'],
      placeholder: 'Select a service desk',
      required: true,
    },
    {
      id: 'serviceDeskId',
      title: 'Service Desk ID',
      type: 'short-input',
      canonicalParamId: 'serviceDeskId',
      mode: 'advanced',
      placeholder: 'e.g. 1, 2',
      required: true,
    },
    {
      id: 'requestTypeSelector',
      title: 'Request Type',
      type: 'selector',
      selectorKey: 'jsm.requestTypes',
      canonicalParamId: 'requestTypeId',
      mode: 'basic',
      dependsOn: ['domain', 'serviceDeskSelector'],
      placeholder: 'All request types',
      required: false,
    },
    {
      id: 'requestTypeId',
      title: 'Request Type ID',
      type: 'short-input',
      canonicalParamId: 'requestTypeId',
      mode: 'advanced',
      placeholder: 'e.g. 10 (leave blank for all)',
      required: false,
    },
    {
      id: 'requestStatus',
      title: 'Request Status',
      type: 'dropdown',
      required: false,
      options: [
        { label: 'All requests', id: 'ALL_REQUESTS' },
        { label: 'Open requests', id: 'OPEN_REQUESTS' },
        { label: 'Closed requests', id: 'CLOSED_REQUESTS' },
      ],
    },
    {
      id: 'requestOwnership',
      title: 'Request Ownership',
      type: 'dropdown',
      required: false,
      description:
        'Which requests the connected account can see. "Owned + participated" is the broadest scope a customer token can sync.',
      options: [
        { label: 'Owned + participated', id: 'ALL_REQUESTS' },
        { label: 'Owned only', id: 'OWNED_REQUESTS' },
        { label: 'Participated only', id: 'PARTICIPATED_REQUESTS' },
      ],
    },
    {
      id: 'comments',
      title: 'Include Comments',
      type: 'dropdown',
      required: false,
      description: 'Comments require an extra API call per request during sync.',
      options: [
        { label: 'Public comments only', id: 'public' },
        { label: 'All comments (incl. internal)', id: 'all' },
        { label: 'No comments', id: 'none' },
      ],
    },
    {
      id: 'searchTerm',
      title: 'Search Filter',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. password reset (optional)',
    },
    {
      id: 'maxRequests',
      title: 'Max Requests',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
    },
  ],

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

    const params = new URLSearchParams({
      serviceDeskId,
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
      throw new Error(`Failed to list JSM requests: ${response.status}`)
    }

    const data = (await response.json()) as JsmPage<JsmRequest>
    let requests = data.values ?? []

    let slicedSome = false
    if (maxRequests > 0 && requests.length > remaining) {
      slicedSome = true
      requests = requests.slice(0, remaining)
    }

    const documents = requests.map((request) => requestToStub(request, domain))

    const newCollected = collectedSoFar + requests.length
    if (syncContext) syncContext.collectedCount = newCollected

    const reachedCap = maxRequests > 0 && newCollected >= maxRequests

    /**
     * When `maxRequests` truncates the listing before the source is exhausted,
     * flag the run as capped so the sync engine skips deletion reconciliation —
     * otherwise unseen requests beyond the cap would be deleted on every sync.
     * `slicedSome` covers truncation on the final page: requests dropped from
     * this page still exist even when `isLastPage` is true. (The requested
     * `limit` never exceeds the remaining budget, so a slice should be
     * impossible — this is defense in depth against the API over-returning.)
     */
    if (((reachedCap && !data.isLastPage) || slicedSome) && syncContext) {
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

    const requestUrl = `${baseUrl}/request/${encodeURIComponent(externalId)}?expand=status`
    const response = await fetchWithRetry(requestUrl, {
      method: 'GET',
      headers: getJsmHeaders(accessToken),
    })

    if (!response.ok) {
      if (response.status === 404) return null
      if (response.status === 401 || response.status === 403) {
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

    try {
      const cloudId = await getJiraCloudId(domain, accessToken, VALIDATE_RETRY_OPTIONS)
      const baseUrl = getJsmApiBaseUrl(cloudId)
      const url = `${baseUrl}/servicedesk/${encodeURIComponent(serviceDeskId)}`

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

  tagDefinitions: [
    { id: 'status', displayName: 'Status', fieldType: 'text' },
    { id: 'requestTypeId', displayName: 'Request Type', fieldType: 'text' },
    { id: 'reporter', displayName: 'Reporter', fieldType: 'text' },
    { id: 'created', displayName: 'Created', fieldType: 'date' },
    { id: 'updated', displayName: 'Last Status Change', fieldType: 'date' },
  ],

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
