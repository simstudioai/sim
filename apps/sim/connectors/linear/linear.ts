import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import type { RetryOptions } from '@/lib/knowledge/documents/utils'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { linearConnectorMeta } from '@/connectors/linear/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  ConnectorListingScopeUnavailableError,
  isListingScopeUnavailableError,
  joinTagArray,
  parseMultiValue,
  parseTagDate,
} from '@/connectors/utils'
import { linearAuthorizationHeader } from '@/tools/linear/utils'

const logger = createLogger('LinearConnector')

const LINEAR_API = 'https://api.linear.app/graphql'

/**
 * Strips Markdown formatting to produce plain text.
 */
function markdownToPlainText(md: string): string {
  let text = md
    .replace(/!\[.*?\]\(.*?\)/g, '') // images
    .replace(/\[([^\]]*)\]\(.*?\)/g, '$1') // links
    .replace(/#{1,6}\s+/g, '') // headings
    .replace(/(\*\*|__)(.*?)\1/g, '$2') // bold
    .replace(/(\*|_)(.*?)\1/g, '$2') // italic
    .replace(/~~(.*?)~~/g, '$1') // strikethrough
    .replace(/`{3}[\s\S]*?`{3}/g, '') // code blocks
    .replace(/`([^`]*)`/g, '$1') // inline code
    .replace(/^\s*[-*+]\s+/gm, '') // list items
    .replace(/^\s*\d+\.\s+/gm, '') // ordered list items
    .replace(/^\s*>\s+/gm, '') // blockquotes
    .replace(/---+/g, '') // horizontal rules
  text = text.replace(/\s+/g, ' ').trim()
  return text
}

interface LinearGraphQLBody {
  data?: Record<string, unknown> | null
  errors?: unknown[]
}

/** Header carrying the UTC epoch-millisecond timestamp at which the request budget refills. */
const RATE_LIMIT_RESET_HEADER = 'X-RateLimit-Requests-Reset'

/**
 * Largest reset wait honored. Linear's request budget refills on a one-hour
 * leaky-bucket period, so the advertised reset instant is usually far too
 * distant to wait for inside a sync. `backoffWithJitter` clamps the header
 * value to this ceiling rather than sleeping until the real reset; if the
 * budget has not recovered within the retry allowance the sync fails and the
 * next scheduled run picks it up.
 */
const MAX_RATE_LIMIT_WAIT_MS = 30_000

/**
 * Detects Linear's `RATELIMITED` extension code anywhere in a GraphQL error array.
 */
function isEntityNotFoundError(entry: unknown): boolean {
  if (!entry || typeof entry !== 'object') return false
  const error = entry as { message?: unknown; extensions?: { code?: unknown } }
  return (
    error.extensions?.code === 'ENTITY_NOT_FOUND' ||
    (typeof error.message === 'string' && /entity not found/i.test(error.message))
  )
}

function isRateLimitedErrors(errors: unknown[] | undefined): boolean {
  if (!Array.isArray(errors)) return false
  return errors.some((entry) => {
    if (typeof entry !== 'object' || entry === null) return false
    const extensions = (entry as { extensions?: unknown }).extensions
    if (typeof extensions !== 'object' || extensions === null) return false
    return (extensions as { code?: unknown }).code === 'RATELIMITED'
  })
}

/**
 * Executes a GraphQL query against the Linear API.
 *
 * Linear signals rate limiting with an HTTP **400** carrying a `RATELIMITED`
 * extension code rather than a 429, so `fetchWithRetry`'s status-based retry
 * never fires for it. This wrapper detects the code on any status and paces its
 * own retries off `X-RateLimit-Requests-Reset` (UTC epoch milliseconds), falling
 * back to jittered exponential backoff when the header is absent.
 */
async function linearGraphQL(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
  retryOptions?: RetryOptions
): Promise<Record<string, unknown>> {
  const maxRateLimitRetries = retryOptions?.maxRetries ?? 3

  for (let attempt = 1; ; attempt++) {
    const response = await fetchWithRetry(
      LINEAR_API,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: linearAuthorizationHeader(accessToken),
        },
        body: JSON.stringify({ query, variables }),
      },
      retryOptions
    )

    const bodyText = await response.text()
    let json: LinearGraphQLBody | undefined
    try {
      json = JSON.parse(bodyText) as LinearGraphQLBody
    } catch {
      json = undefined
    }

    if (isRateLimitedErrors(json?.errors) && attempt <= maxRateLimitRetries) {
      const resetHeader = response.headers.get(RATE_LIMIT_RESET_HEADER)
      const resetIn = resetHeader ? Number(resetHeader) - Date.now() : Number.NaN
      const delayMs = backoffWithJitter(attempt, resetIn > 0 ? resetIn : null, {
        maxMs: MAX_RATE_LIMIT_WAIT_MS,
      })
      logger.warn('Linear rate limited; backing off', { attempt, delayMs })
      await sleep(delayMs)
      continue
    }

    if (!response.ok) {
      logger.error('Linear GraphQL request failed', { status: response.status, error: bodyText })
      throw new Error(`Linear API error: ${response.status}`)
    }

    /**
     * Linear reports validation, authorization, complexity, and rate-limit failures
     * as HTTP 200 with a populated `errors` array and `data: null` (or a partially
     * null `data`). Throwing here is deliberate: returning the partial payload would
     * let `listDocuments` surface an empty node list, which the sync engine would
     * read as "the source has no issues" and hard-delete every stored document.
     */
    if (Array.isArray(json?.errors) && json.errors.length > 0) {
      logger.error('Linear GraphQL errors', { errors: json.errors })
      const described = `Linear GraphQL error: ${JSON.stringify(json.errors)}`
      /** A team or project the caller cannot see is reported as an entity that does not exist. */
      throw json.errors.some(isEntityNotFoundError)
        ? new ConnectorListingScopeUnavailableError(described, response.status)
        : new Error(described)
    }

    if (!json?.data || typeof json.data !== 'object') {
      throw new Error('Linear API returned no data')
    }

    return json.data
  }
}

/**
 * Builds a formatted text document from a Linear issue.
 */
function buildIssueContent(issue: Record<string, unknown>): string {
  const parts: string[] = []

  const identifier = issue.identifier as string | undefined
  const title = (issue.title as string) || 'Untitled'
  parts.push(`${identifier ? `${identifier}: ` : ''}${title}`)

  const state = issue.state as Record<string, unknown> | undefined
  if (state?.name) parts.push(`Status: ${state.name}`)

  const priority = issue.priorityLabel as string | undefined
  if (priority) parts.push(`Priority: ${priority}`)

  const assignee = issue.assignee as Record<string, unknown> | undefined
  if (assignee?.name) parts.push(`Assignee: ${assignee.name}`)

  const labelsConn = issue.labels as Record<string, unknown> | undefined
  const labelNodes = (labelsConn?.nodes || []) as Record<string, unknown>[]
  if (labelNodes.length > 0) {
    parts.push(`Labels: ${labelNodes.map((l) => l.name as string).join(', ')}`)
  }

  const description = issue.description as string | undefined
  if (description) {
    parts.push('')
    parts.push(markdownToPlainText(description))
  }

  return parts.join('\n')
}

const ISSUE_FIELDS = `
  id
  identifier
  title
  description
  priority
  priorityLabel
  url
  createdAt
  updatedAt
  state { name }
  assignee { name }
  labels { nodes { name } }
  team { name key }
  project { name }
`

/**
 * Linear's `issue` query takes `id: String!`, not `ID!` — a mismatched variable
 * definition fails GraphQL validation and returns HTTP 200 with `errors[]`.
 */
const ISSUE_BY_ID_QUERY = `
  query GetIssue($id: String!) {
    issue(id: $id) {
      ${ISSUE_FIELDS}
    }
  }
`

/**
 * Filters are passed as a single `IssueFilter` variable rather than interpolated
 * into the query text, so a static document covers every filter combination and
 * no user-controlled value ever reaches the query string.
 */
const LIST_ISSUES_QUERY = `
  query ListIssues($filter: IssueFilter, $first: Int!, $after: String) {
    issues(filter: $filter, first: $first, after: $after) {
      nodes {
        ${ISSUE_FIELDS}
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`

const TEAMS_QUERY = `
  query { teams { nodes { id name key } } }
`

/**
 * Linear documents 50 as the connection default and publishes no maximum for
 * `first`, so the default is used as-is. Each issue node also expands a nested
 * `labels` connection (itself defaulting to 50), and Linear rejects any single
 * query costing more than 10,000 complexity points — raising this would push
 * toward that ceiling for no pagination benefit.
 */
const MAX_PAGE_SIZE = 50

/**
 * Builds the `IssueFilter` argument, omitting comparators that have no value so
 * Linear never receives a null comparator. Returns undefined when unfiltered.
 */
function buildIssuesFilter(
  sourceConfig: Record<string, unknown>,
  teamIds: string[],
  projectIds: string[],
  lastSyncAt?: Date
): Record<string, unknown> | undefined {
  const filter: Record<string, unknown> = {}

  if (teamIds.length === 1) filter.team = { id: { eq: teamIds[0] } }
  else if (teamIds.length > 1) filter.team = { id: { in: teamIds } }

  if (projectIds.length === 1) filter.project = { id: { eq: projectIds[0] } }
  else if (projectIds.length > 1) filter.project = { id: { in: projectIds } }

  const states = parseMultiValue(sourceConfig.stateFilter)
  if (states.length > 0) filter.state = { name: { in: states } }

  if (lastSyncAt) filter.updatedAt = { gte: lastSyncAt.toISOString() }

  return Object.keys(filter).length > 0 ? filter : undefined
}

/**
 * Projects a Linear issue node into an ExternalDocument. Shared by
 * `listDocuments` and `getDocument` so `contentHash` and `metadata` are
 * byte-identical regardless of which path produced the document.
 */
function issueToDocument(issue: Record<string, unknown>): ExternalDocument {
  const labelNodes = ((issue.labels as Record<string, unknown>)?.nodes || []) as Record<
    string,
    unknown
  >[]
  const identifier = (issue.identifier as string) || ''
  const title = (issue.title as string) || 'Untitled'

  return {
    externalId: issue.id as string,
    title: identifier ? `${identifier}: ${title}` : title,
    content: buildIssueContent(issue),
    mimeType: 'text/plain' as const,
    sourceUrl: (issue.url as string) || undefined,
    contentHash: `linear:${issue.id}:${issue.updatedAt}`,
    metadata: {
      identifier: issue.identifier,
      state: (issue.state as Record<string, unknown>)?.name,
      priority: issue.priorityLabel,
      assignee: (issue.assignee as Record<string, unknown>)?.name,
      labels: labelNodes.map((l) => l.name as string),
      team: (issue.team as Record<string, unknown>)?.name,
      project: (issue.project as Record<string, unknown>)?.name,
      lastModified: issue.updatedAt,
    },
  }
}

export const linearConnector: ConnectorConfig = {
  ...linearConnectorMeta,

  isListingScopeUnavailableError,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>,
    lastSyncAt?: Date
  ): Promise<ExternalDocumentList> => {
    const parsedMax = Number(sourceConfig.maxIssues)
    const maxIssues = Number.isFinite(parsedMax) && parsedMax > 0 ? Math.floor(parsedMax) : 0

    const previouslyFetched = (syncContext?.totalDocsFetched as number) ?? 0
    const remaining =
      maxIssues > 0 ? Math.max(0, maxIssues - previouslyFetched) : Number.POSITIVE_INFINITY
    const pageSize = Math.max(1, Math.min(MAX_PAGE_SIZE, remaining))

    const teamIds = parseMultiValue(sourceConfig.teamId)
    const projectIds = parseMultiValue(sourceConfig.projectId)
    const filter = buildIssuesFilter(sourceConfig, teamIds, projectIds, lastSyncAt)

    logger.info('Listing Linear issues', {
      cursor,
      pageSize,
      teamFilterCount: teamIds.length,
      projectFilterCount: projectIds.length,
      incremental: Boolean(lastSyncAt),
    })

    const data = await linearGraphQL(accessToken, LIST_ISSUES_QUERY, {
      filter,
      first: pageSize,
      after: cursor || undefined,
    })
    /**
     * `issues` is declared `IssueConnection!`, so a missing connection means a
     * malformed response, not an empty source. Defaulting it to `{}` would
     * present an empty listing, which the sync engine reads as "every stored
     * issue was deleted" — so this throws instead.
     */
    const issuesConn = data.issues as Record<string, unknown> | undefined
    if (!issuesConn || typeof issuesConn !== 'object') {
      throw new Error('Linear API returned no issues connection')
    }
    const nodes = (issuesConn.nodes || []) as Record<string, unknown>[]
    const pageInfo = (issuesConn.pageInfo || {}) as Record<string, unknown>

    const documents = nodes.map(issueToDocument)

    const hasNextPage = Boolean(pageInfo.hasNextPage)
    const endCursor = (pageInfo.endCursor as string) || undefined

    const totalFetched = previouslyFetched + documents.length
    if (syncContext) syncContext.totalDocsFetched = totalFetched
    const hitLimit = maxIssues > 0 && totalFetched >= maxIssues

    /**
     * The `maxIssues` cap hides issues that still exist in Linear. The sync
     * engine hard-deletes every stored document absent from a full listing, so
     * a capped listing must be flagged. `first` is already clamped to the
     * remaining budget, so the cap only hides issues when Linear reports a
     * further page; genuine exhaustion is left unflagged so real deletions still
     * reconcile. The team/project/state filters are intentional scope, not a cap.
     */
    if (hitLimit && hasNextPage && syncContext) {
      syncContext.listingCapped = true
    }

    return {
      documents,
      nextCursor: hasNextPage && !hitLimit ? endCursor : undefined,
      hasMore: hasNextPage && !hitLimit,
    }
  },

  getDocument: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    externalId: string
  ): Promise<ExternalDocument | null> => {
    const data = await linearGraphQL(accessToken, ISSUE_BY_ID_QUERY, { id: externalId })
    const issue = data.issue as Record<string, unknown> | null

    /**
     * `issue` is declared `Issue!`, so Linear reports a missing issue as a
     * GraphQL error rather than a null node — this guard is defence against a
     * malformed body only. Transport, auth, and GraphQL failures propagate out
     * of `linearGraphQL` so the sync engine records a visible failed document
     * rather than silently dropping the issue.
     */
    if (!issue) return null

    return issueToDocument(issue)
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const maxIssues = sourceConfig.maxIssues as string | undefined
    if (maxIssues && (Number.isNaN(Number(maxIssues)) || Number(maxIssues) <= 0)) {
      return { valid: false, error: 'Max issues must be a positive number' }
    }

    try {
      const data = await linearGraphQL(accessToken, TEAMS_QUERY, undefined, VALIDATE_RETRY_OPTIONS)
      const teamsConn = data.teams as Record<string, unknown>
      const teams = (teamsConn.nodes || []) as Record<string, unknown>[]

      if (teams.length === 0) {
        return {
          valid: false,
          error: 'No teams found — check that the OAuth token has read access',
        }
      }

      const requestedTeamIds = parseMultiValue(sourceConfig.teamId)
      if (requestedTeamIds.length > 0) {
        const availableIds = new Set(teams.map((t) => t.id as string))
        const missing = requestedTeamIds.filter((id) => !availableIds.has(id))
        if (missing.length > 0) {
          return {
            valid: false,
            error: `Team ID(s) not found: ${missing.join(', ')}. Available teams: ${teams.map((t) => `${t.name} (${t.id})`).join(', ')}`,
          }
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

    const labels = joinTagArray(metadata.labels)
    if (labels) result.labels = labels

    if (typeof metadata.state === 'string') result.state = metadata.state
    if (typeof metadata.priority === 'string') result.priority = metadata.priority
    if (typeof metadata.assignee === 'string') result.assignee = metadata.assignee

    const lastModified = parseTagDate(metadata.lastModified)
    if (lastModified) result.lastModified = lastModified

    return result
  },
}
