import { createLogger } from '@sim/logger'
import { getErrorMessage, toError } from '@sim/utils/errors'
import { SentryIcon } from '@/components/icons'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import { parseTagDate } from '@/connectors/utils'

const logger = createLogger('SentryConnector')

const DEFAULT_HOST = 'sentry.io'
const ISSUES_PER_PAGE = 100

/**
 * Default issue search query.
 *
 * Reconciliation semantics: the sync engine hard-deletes any previously-synced
 * document whose `externalId` is absent from a full (non-capped) listing pass.
 * With the default `is:unresolved` query this means an issue that is resolved,
 * ignored/muted, or aged out of the query window will fall out of the listing
 * and be removed from the knowledge base on the next full sync. That is the
 * intended semantic — the KB tracks the *currently matching* issue set, not a
 * permanent archive. Users who want resolved issues retained should widen the
 * query (e.g. drop `is:unresolved`). When `maxIssues` caps the listing, the
 * engine sets `listingCapped` and skips deletion, so capped runs never remove
 * unseen issues.
 */
const DEFAULT_QUERY = 'is:unresolved'

/**
 * Allowed `statsPeriod` values for the project issues list endpoint. Sentry's
 * project issues endpoint only honors `24h` (default) or `14d` for its timeline
 * stats; an empty value disables the stats window. Other periods (e.g. `90d`)
 * are accepted by the organization issues endpoint but not this one, so they are
 * rejected during validation to avoid a silently-ignored filter.
 */
const ALLOWED_STATS_PERIODS = new Set(['24h', '14d'])

/**
 * Metadata block on a Sentry issue, carrying the human-readable error type/value.
 */
interface SentryIssueMetadata {
  type?: string
  value?: string
  function?: string
  title?: string
}

/**
 * A single issue (error group) returned by the issues list/detail endpoints.
 */
interface SentryIssue {
  id: string
  shortId?: string
  title?: string
  culprit?: string | null
  permalink?: string
  logger?: string | null
  level?: string
  status?: string
  platform?: string | null
  type?: string | null
  metadata?: SentryIssueMetadata
  /** Sentry returns the event count as a string (e.g. "12"), not a number. */
  count?: string
  userCount?: number
  firstSeen?: string
  lastSeen?: string
}

/**
 * One entry inside a Sentry event. Entries carry the structured payload (exception,
 * breadcrumbs, request, message) keyed by `type`, with the shape under `data` varying
 * per entry type.
 */
interface SentryEventEntry {
  type?: string
  data?: unknown
}

/**
 * A key/value tag pair attached to a Sentry event.
 */
interface SentryEventTag {
  key?: string
  value?: string
}

/**
 * The latest event for an issue, used to enrich the synced document with the concrete
 * message, exception detail, and tags from the most recent occurrence.
 */
interface SentryEvent {
  id?: string
  eventID?: string
  message?: string
  title?: string
  culprit?: string | null
  platform?: string | null
  dateCreated?: string
  metadata?: SentryIssueMetadata
  entries?: SentryEventEntry[]
  tags?: SentryEventTag[]
}

/**
 * The shape of an exception entry's `data` payload: a list of exception values, each
 * with a type, message, and an optional rendered stack frame list.
 */
interface SentryExceptionData {
  values?: {
    type?: string
    value?: string
    module?: string
    stacktrace?: {
      frames?: {
        filename?: string
        function?: string
        lineNo?: number
        module?: string
      }[]
    }
  }[]
}

/**
 * Resolved connector source configuration after normalization.
 */
interface SentrySourceConfig {
  /** Bare host (no protocol, no trailing slash), e.g. `sentry.io` or a self-hosted host. */
  host: string
  /** REST API base, e.g. `https://sentry.io/api/0`. */
  apiBase: string
  organization: string
  project: string
  query: string
  statsPeriod: string
  environment: string
  maxIssues: number
}

/**
 * Normalizes the host config value: trims whitespace, strips any protocol prefix,
 * trailing slashes, and a pasted `/api` or `/api/0` suffix (the connector appends
 * `/api/0` itself), and falls back to sentry.io when empty. Genuine path prefixes
 * (e.g. `company.com/sentry` for subpath self-hosted installs) are preserved.
 */
function normalizeHost(rawHost: unknown): string {
  const host = typeof rawHost === 'string' ? rawHost.trim() : ''
  if (!host) return DEFAULT_HOST
  return host
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .replace(/\/api(\/0)?$/i, '')
    .replace(/\/+$/, '')
    .trim()
}

/**
 * Reads and normalizes the connector source configuration once per call.
 */
function readSourceConfig(sourceConfig: Record<string, unknown>): SentrySourceConfig {
  const host = normalizeHost(sourceConfig.baseUrl)
  const organization =
    typeof sourceConfig.organization === 'string' ? sourceConfig.organization.trim() : ''
  const project = typeof sourceConfig.project === 'string' ? sourceConfig.project.trim() : ''
  const query =
    typeof sourceConfig.query === 'string' && sourceConfig.query.trim()
      ? sourceConfig.query.trim()
      : DEFAULT_QUERY
  const statsPeriod =
    typeof sourceConfig.statsPeriod === 'string' ? sourceConfig.statsPeriod.trim() : ''
  const environment =
    typeof sourceConfig.environment === 'string' ? sourceConfig.environment.trim() : ''
  const maxIssues = sourceConfig.maxIssues ? Number(sourceConfig.maxIssues) : 0

  return {
    host,
    apiBase: `https://${host}/api/0`,
    organization,
    project,
    query,
    statsPeriod,
    environment,
    maxIssues,
  }
}

/**
 * Builds the standard JSON request headers carrying the Sentry auth token.
 */
function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
}

/**
 * Reads the `cursor` of the `rel="next"` link from a Sentry `Link` header.
 *
 * Sentry paginates via the `Link` header: each link is annotated with `rel`,
 * `results`, and `cursor` attributes, e.g.
 * `<https://…/issues/?cursor=0:100:0>; rel="next"; results="true"; cursor="0:100:0"`.
 * A further page exists only when the `next` link reports `results="true"`; when it
 * reports `results="false"` (or the header is absent) the cursor points at an empty
 * page and pagination must stop. The cursor is read from the `cursor="…"` attribute,
 * which is the canonical token Sentry expects echoed back on the next request.
 */
function parseNextCursor(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined

  for (const part of linkHeader.split(',')) {
    if (!/rel="next"/.test(part)) continue
    if (!/results="true"/.test(part)) return undefined
    const cursorMatch = part.match(/cursor="([^"]*)"/)
    if (cursorMatch) return cursorMatch[1]
    return undefined
  }

  return undefined
}

/**
 * Builds the metadata-based content hash for an issue.
 *
 * The hash combines the issue id, its status, and `lastSeen`. `lastSeen` advances every
 * time a new event lands on the group, which is exactly when the latest-event content can
 * change — so it captures content freshness without hashing the downloaded body. `status`
 * is included so resolve/ignore transitions also re-sync. `count` is deliberately omitted:
 * it changes on every single occurrence and would churn the document on each event even
 * when `lastSeen` already moved, providing no extra signal over `lastSeen`.
 *
 * The hash is derived purely from issue metadata present on both the list stub and the
 * getDocument detail fetch, so both paths produce an identical hash for the same issue
 * snapshot. If a fresh event lands between listing and hydration, `lastSeen` advances and
 * getDocument computes a newer hash; the sync engine stores that newer hash, which the next
 * list pass reproduces — so the document converges without churn.
 */
function buildContentHash(issue: SentryIssue): string {
  return `sentry:${issue.id}:${issue.status ?? ''}:${issue.lastSeen ?? ''}`
}

/**
 * Builds the document title, preferring the issue title and falling back to the
 * metadata type/value or short id.
 */
function buildTitle(issue: SentryIssue): string {
  const title = issue.title?.trim()
  if (title) return title

  const metaType = issue.metadata?.type?.trim()
  const metaValue = issue.metadata?.value?.trim()
  if (metaType && metaValue) return `${metaType}: ${metaValue}`
  return metaType || issue.shortId || `Issue ${issue.id}`
}

/**
 * Collects the source-specific metadata fed to mapTags. Shared between the list stub and
 * getDocument so tag values stay consistent regardless of which path produced the doc.
 */
function buildMetadata(issue: SentryIssue): Record<string, unknown> {
  return {
    level: issue.level,
    status: issue.status,
    firstSeen: issue.firstSeen,
    lastSeen: issue.lastSeen,
    count: issue.count != null ? Number(issue.count) : undefined,
  }
}

/**
 * Creates a lightweight document stub from a list entry. No per-issue API calls — the
 * latest-event content is deferred to getDocument and only fetched for new/changed issues.
 */
function issueToStub(issue: SentryIssue): ExternalDocument {
  return {
    externalId: issue.id,
    title: buildTitle(issue),
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: issue.permalink || undefined,
    contentHash: buildContentHash(issue),
    metadata: buildMetadata(issue),
  }
}

/**
 * Renders the exception entry of a latest event into readable lines: each exception's
 * type/value plus a compact, top-down stack frame list.
 */
function formatException(data: SentryExceptionData): string[] {
  const lines: string[] = []

  for (const value of data.values ?? []) {
    const header = [value.type, value.value].filter(Boolean).join(': ')
    if (header) lines.push(header)

    const frames = value.stacktrace?.frames ?? []
    for (const frame of frames.slice().reverse()) {
      const location = [frame.module || frame.filename, frame.function].filter(Boolean).join(' in ')
      const lineNo = frame.lineNo != null ? `:${frame.lineNo}` : ''
      if (location) lines.push(`  at ${location}${lineNo}`)
    }
  }

  return lines
}

/**
 * Formats an issue and its latest event into a single plain-text document covering the
 * title, culprit, counts, the latest event's message/exception, and event tags.
 */
function formatIssueContent(issue: SentryIssue, event: SentryEvent | null): string {
  const parts: string[] = []

  parts.push(`Issue: ${buildTitle(issue)}`)
  if (issue.shortId) parts.push(`Short ID: ${issue.shortId}`)
  if (issue.culprit) parts.push(`Culprit: ${issue.culprit}`)
  if (issue.level) parts.push(`Level: ${issue.level}`)
  if (issue.status) parts.push(`Status: ${issue.status}`)
  if (issue.platform) parts.push(`Platform: ${issue.platform}`)
  if (issue.count) parts.push(`Events: ${issue.count}`)
  if (issue.userCount != null) parts.push(`Users affected: ${issue.userCount}`)
  if (issue.firstSeen) parts.push(`First seen: ${issue.firstSeen}`)
  if (issue.lastSeen) parts.push(`Last seen: ${issue.lastSeen}`)

  if (event) {
    const message = event.message?.trim() || event.title?.trim()
    if (message) {
      parts.push('')
      parts.push('--- Latest Event ---')
      if (event.dateCreated) parts.push(`Occurred: ${event.dateCreated}`)
      parts.push(message)
    }

    const exceptionEntry = event.entries?.find((entry) => entry.type === 'exception')
    if (exceptionEntry?.data) {
      const exceptionLines = formatException(exceptionEntry.data as SentryExceptionData)
      if (exceptionLines.length > 0) {
        parts.push('')
        parts.push('--- Exception ---')
        parts.push(...exceptionLines)
      }
    }

    const tagLines = (event.tags ?? [])
      .map((tag) => (tag.key && tag.value ? `${tag.key}: ${tag.value}` : undefined))
      .filter((line): line is string => Boolean(line))
    if (tagLines.length > 0) {
      parts.push('')
      parts.push('--- Tags ---')
      parts.push(...tagLines)
    }
  }

  return parts.join('\n').trim()
}

/**
 * Fetches the latest event for an issue. Returns null when the issue has no events or the
 * request fails, so the document still syncs with its list-level summary.
 *
 * Uses the organization-scoped event endpoint
 * `/api/0/organizations/{org}/issues/{id}/events/latest/`, which is the documented path
 * and works for both sentry.io and self-hosted installs.
 */
async function fetchLatestEvent(
  apiBase: string,
  organization: string,
  accessToken: string,
  issueId: string
): Promise<SentryEvent | null> {
  const url = `${apiBase}/organizations/${encodeURIComponent(organization)}/issues/${encodeURIComponent(issueId)}/events/latest/`

  const response = await fetchWithRetry(url, {
    method: 'GET',
    headers: authHeaders(accessToken),
  })

  if (!response.ok) {
    if (response.status !== 404) {
      logger.warn('Failed to fetch latest Sentry event', { issueId, status: response.status })
    }
    return null
  }

  return (await response.json()) as SentryEvent
}

export const sentryConnector: ConnectorConfig = {
  id: 'sentry',
  name: 'Sentry',
  description: 'Sync issues and errors from Sentry into your knowledge base',
  version: '1.0.0',
  icon: SentryIcon,

  auth: {
    mode: 'apiKey',
    label: 'Auth Token',
    placeholder: 'Enter your Sentry auth token',
  },

  configFields: [
    {
      id: 'baseUrl',
      title: 'Sentry URL',
      type: 'short-input',
      placeholder: 'sentry.io',
      required: false,
      mode: 'advanced',
      description:
        'Host of your Sentry install. Leave blank for sentry.io. Set this for self-hosted Sentry (e.g. sentry.mycompany.com).',
    },
    {
      id: 'organization',
      title: 'Organization Slug',
      type: 'short-input',
      placeholder: 'e.g. my-org',
      required: true,
      description: 'The slug of your Sentry organization.',
    },
    {
      id: 'project',
      title: 'Project Slug',
      type: 'short-input',
      placeholder: 'e.g. my-project',
      required: true,
      description: 'The slug of the project whose issues should be synced.',
    },
    {
      id: 'query',
      title: 'Search Query',
      type: 'short-input',
      placeholder: `e.g. ${DEFAULT_QUERY}`,
      required: false,
      description:
        'Sentry search query to filter issues (e.g. "is:unresolved level:error environment:production"). Defaults to "is:unresolved".',
    },
    {
      id: 'environment',
      title: 'Environment',
      type: 'short-input',
      required: false,
      mode: 'advanced',
      placeholder: 'e.g. production',
      description: 'Only sync issues seen in this environment. Leave blank for all environments.',
    },
    {
      id: 'statsPeriod',
      title: 'Stats Period',
      type: 'dropdown',
      required: false,
      mode: 'advanced',
      options: [
        { label: 'Sentry default (24h)', id: '' },
        { label: 'Last 24 hours', id: '24h' },
        { label: 'Last 14 days', id: '14d' },
      ],
      description: 'Time window for the issue stats Sentry computes on the project issues list.',
    },
    {
      id: 'maxIssues',
      title: 'Max Issues',
      type: 'short-input',
      required: false,
      placeholder: 'e.g. 500 (default: unlimited)',
      description: 'Cap the number of issues synced. Leave empty to sync all matching issues.',
    },
  ],

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const { apiBase, organization, project, query, statsPeriod, environment, maxIssues } =
      readSourceConfig(sourceConfig)

    if (!organization || !project) {
      throw new Error('Organization and project slugs are required')
    }

    /*
     * Uses the project issues list endpoint
     * `/api/0/projects/{org}/{project}/issues/`. This endpoint is deprecated in favor of
     * `/api/0/organizations/{org}/issues/?project=<id>`, but the organization endpoint
     * filters by numeric project ID rather than slug — a UX regression for a connector
     * keyed on the human-readable project slug. The project endpoint remains functional
     * and slug-addressable, so it is retained deliberately for the listing path. Issue
     * detail and latest-event fetches use the organization-scoped paths.
     */
    const url = new URL(
      `${apiBase}/projects/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/issues/`
    )
    url.searchParams.set('query', query)
    url.searchParams.set('limit', String(ISSUES_PER_PAGE))
    if (statsPeriod) url.searchParams.set('statsPeriod', statsPeriod)
    if (environment) url.searchParams.set('environment', environment)
    if (cursor) url.searchParams.set('cursor', cursor)

    logger.info('Listing Sentry issues', {
      organization,
      project,
      cursor: cursor ?? 'initial',
      maxIssues,
    })

    const response = await fetchWithRetry(url.toString(), {
      method: 'GET',
      headers: authHeaders(accessToken),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      logger.error('Failed to list Sentry issues', {
        status: response.status,
        error: errorText.slice(0, 500),
      })
      throw new Error(`Failed to list Sentry issues: ${response.status}`)
    }

    const issues = ((await response.json()) as SentryIssue[]).filter((issue) => Boolean(issue.id))

    const prevFetched = (syncContext?.totalDocsFetched as number) ?? 0
    let documents = issues.map(issueToStub)
    let slicedSome = false
    if (maxIssues > 0) {
      const remaining = Math.max(0, maxIssues - prevFetched)
      if (documents.length > remaining) {
        slicedSome = true
        documents = documents.slice(0, remaining)
      }
    }

    const totalFetched = prevFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = maxIssues > 0 && totalFetched >= maxIssues

    const nextCursor = parseNextCursor(response.headers.get('Link'))
    if (hitLimit && (slicedSome || Boolean(nextCursor)) && syncContext) {
      syncContext.listingCapped = true
    }
    const hasMore = !hitLimit && Boolean(nextCursor)

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

      const { apiBase, organization } = readSourceConfig(sourceConfig)
      if (!organization) return null

      const url = `${apiBase}/organizations/${encodeURIComponent(organization)}/issues/${encodeURIComponent(externalId)}/`

      const response = await fetchWithRetry(url, {
        method: 'GET',
        headers: authHeaders(accessToken),
      })

      if (!response.ok) {
        if (response.status === 404 || response.status === 410) return null
        throw new Error(`Failed to fetch Sentry issue: ${response.status}`)
      }

      const issue = (await response.json()) as SentryIssue
      if (!issue?.id) return null

      const event = await fetchLatestEvent(apiBase, organization, accessToken, issue.id)
      const content = formatIssueContent(issue, event)
      if (!content.trim()) return null

      return {
        externalId: issue.id,
        title: buildTitle(issue),
        content,
        contentDeferred: false,
        mimeType: 'text/plain',
        sourceUrl: issue.permalink || undefined,
        contentHash: buildContentHash(issue),
        metadata: buildMetadata(issue),
      }
    } catch (error) {
      logger.warn('Failed to get Sentry issue', {
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
    const { apiBase, organization, project, statsPeriod, maxIssues, host } =
      readSourceConfig(sourceConfig)

    if (!organization) {
      return { valid: false, error: 'Organization slug is required' }
    }
    if (!project) {
      return { valid: false, error: 'Project slug is required' }
    }

    if (statsPeriod && !ALLOWED_STATS_PERIODS.has(statsPeriod)) {
      return { valid: false, error: 'Stats period must be 24h or 14d' }
    }

    const rawMax = sourceConfig.maxIssues as string | undefined
    if (rawMax && (Number.isNaN(maxIssues) || maxIssues < 0)) {
      return { valid: false, error: 'Max issues must be a non-negative number' }
    }

    try {
      /*
       * Probe the project detail endpoint first. This exercises the `project:read`
       * scope and the project-scoped path style, and gives a precise "not found"
       * message when the org or project slug is wrong.
       */
      const projectResponse = await fetchWithRetry(
        `${apiBase}/projects/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/`,
        {
          method: 'GET',
          headers: authHeaders(accessToken),
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!projectResponse.ok) {
        if (projectResponse.status === 401 || projectResponse.status === 403) {
          return { valid: false, error: 'Invalid auth token or insufficient permissions' }
        }
        if (projectResponse.status === 404) {
          return {
            valid: false,
            error: `Organization or project not found on ${host}`,
          }
        }
        const errorText = await projectResponse.text().catch(() => '')
        return {
          valid: false,
          error: `Sentry access failed: ${projectResponse.status}${errorText ? ` — ${errorText.slice(0, 200)}` : ''}`,
        }
      }

      /*
       * Probe the issues-list endpoint with a single-result page. The project
       * detail probe above only proves `project:read`, but every sync operation —
       * `listDocuments` and the org-scoped `getDocument`/latest-event hydration —
       * needs `event:read`. A token scoped to `project:read` only would pass the
       * first probe yet fail at hydration time, so this second probe forces a
       * misconfigured token to fail fast at save time. It is slug-addressable and
       * cheap (one issue, no stats window).
       */
      const issuesProbeUrl = new URL(
        `${apiBase}/projects/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/issues/`
      )
      issuesProbeUrl.searchParams.set('query', DEFAULT_QUERY)
      issuesProbeUrl.searchParams.set('limit', '1')

      const issuesResponse = await fetchWithRetry(
        issuesProbeUrl.toString(),
        {
          method: 'GET',
          headers: authHeaders(accessToken),
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!issuesResponse.ok) {
        if (issuesResponse.status === 401 || issuesResponse.status === 403) {
          return {
            valid: false,
            error:
              'Auth token cannot read issues. The token needs the "event:read" scope (in addition to "project:read").',
          }
        }
        const errorText = await issuesResponse.text().catch(() => '')
        return {
          valid: false,
          error: `Sentry issue access failed: ${issuesResponse.status}${errorText ? ` — ${errorText.slice(0, 200)}` : ''}`,
        }
      }

      return { valid: true }
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to validate configuration')
      return { valid: false, error: message }
    }
  },

  tagDefinitions: [
    { id: 'level', displayName: 'Level', fieldType: 'text' },
    { id: 'status', displayName: 'Status', fieldType: 'text' },
    { id: 'count', displayName: 'Event Count', fieldType: 'number' },
    { id: 'firstSeen', displayName: 'First Seen', fieldType: 'date' },
    { id: 'lastSeen', displayName: 'Last Seen', fieldType: 'date' },
  ],

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.level === 'string' && metadata.level.trim()) {
      result.level = metadata.level
    }

    if (typeof metadata.status === 'string' && metadata.status.trim()) {
      result.status = metadata.status
    }

    if (metadata.count != null) {
      const num = Number(metadata.count)
      if (!Number.isNaN(num)) result.count = num
    }

    const firstSeen = parseTagDate(metadata.firstSeen)
    if (firstSeen) result.firstSeen = firstSeen

    const lastSeen = parseTagDate(metadata.lastSeen)
    if (lastSeen) result.lastSeen = lastSeen

    return result
  },
}
