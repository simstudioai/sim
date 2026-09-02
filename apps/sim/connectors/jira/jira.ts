import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import {
  AtlassianSiteNotAccessibleError,
  AtlassianSiteNotMatchedError,
  normalizeAtlassianSiteUrl,
} from '@/lib/atlassian/discovery'
import { fetchWithRetry, VALIDATE_RETRY_OPTIONS } from '@/lib/knowledge/documents/utils'
import { jiraConnectorMeta } from '@/connectors/jira/meta'
import type { ConnectorConfig, ExternalDocument, ExternalDocumentList } from '@/connectors/types'
import {
  isListingScopeUnavailableError,
  joinTagArray,
  listingRequestError,
  parseMultiValue,
  parseTagDate,
} from '@/connectors/utils'
import { extractAdfText, getJiraCloudId } from '@/tools/jira/utils'

const logger = createLogger('JiraConnector')

/**
 * `maxResults` on `/rest/api/3/search/jql` is a ceiling, not a guarantee: the
 * docs state the API "may return fewer items per page where a large number of
 * fields or properties are requested", and that the documented 5000 maximum is
 * only reached "when requesting `id` or `key` only". Since this listing requests
 * a field selection, a request for more than ~100 buys nothing.
 *
 * Under-delivery is harmless either way — end-of-results is signalled purely by
 * the absence of `nextPageToken`, never by a short page.
 */
const PAGE_SIZE = 100

/**
 * Builds a JQL clause restricting issues to the given project keys.
 * Single key uses `project = "X"`; multiple keys use `project in ("X","Y")`.
 * Each key is escaped for inclusion in a JQL double-quoted string.
 */
function buildProjectClause(projectKeys: string[]): string {
  const escapeKey = (key: string) => key.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  if (projectKeys.length === 1) {
    return `project = "${escapeKey(projectKeys[0])}"`
  }
  const list = projectKeys.map((k) => `"${escapeKey(k)}"`).join(',')
  return `project in (${list})`
}

/**
 * Builds a plain-text representation of a Jira issue for knowledge base indexing.
 */
function buildIssueContent(fields: Record<string, unknown>): string {
  const parts: string[] = []

  const summary = fields.summary as string | undefined
  if (summary) parts.push(summary)

  const description = extractAdfText(fields.description)
  if (description) parts.push(description)

  const comments = fields.comment as
    | { comments?: Array<{ body?: unknown }>; total?: number }
    | undefined
  if (comments?.comments) {
    for (const comment of comments.comments) {
      const text = extractAdfText(comment.body)
      if (text) parts.push(text)
    }
    /**
     * The `comment` field on `GET /rest/api/3/issue/{id}` is a paginated
     * container: it reports `total` alongside the subset it actually inlines. No
     * exact inline limit is documented, so the only reliable signal that an issue
     * was indexed without part of its thread is `total` exceeding what arrived.
     */
    if (typeof comments.total === 'number' && comments.total > comments.comments.length) {
      logger.warn('Jira issue comments truncated by the API; indexing the returned subset', {
        returned: comments.comments.length,
        total: comments.total,
      })
    }
  }

  return parts.join('\n\n').trim()
}

/**
 * Extracts common metadata fields from a Jira issue into an ExternalDocument
 * stub with deferred content. The contentHash is metadata-based so it is
 * identical whether produced during listing or full fetch.
 */
function issueToStub(issue: Record<string, unknown>, siteUrl: string): ExternalDocument {
  const fields = (issue.fields || {}) as Record<string, unknown>
  const key = issue.key as string
  const issueType = fields.issuetype as Record<string, unknown> | undefined
  const status = fields.status as Record<string, unknown> | undefined
  const priority = fields.priority as Record<string, unknown> | undefined
  const assignee = fields.assignee as Record<string, unknown> | undefined
  const reporter = fields.reporter as Record<string, unknown> | undefined
  const project = fields.project as Record<string, unknown> | undefined
  const labels = Array.isArray(fields.labels) ? (fields.labels as string[]) : []
  const updated = (fields.updated as string) ?? ''

  return {
    externalId: String(issue.id),
    title: `${key}: ${(fields.summary as string) || 'Untitled'}`,
    content: '',
    contentDeferred: true,
    mimeType: 'text/plain',
    sourceUrl: `${siteUrl}/browse/${key}`,
    contentHash: `jira:${issue.id}:${updated}`,
    metadata: {
      key,
      issueType: issueType?.name,
      status: status?.name,
      priority: priority?.name,
      assignee: assignee?.displayName,
      reporter: reporter?.displayName,
      project: project?.key,
      labels,
      created: fields.created,
      updated: fields.updated,
    },
  }
}

/**
 * Converts a fully-fetched Jira issue (with description and comments) into an
 * ExternalDocument with resolved content.
 */
function issueToFullDocument(issue: Record<string, unknown>, siteUrl: string): ExternalDocument {
  const stub = issueToStub(issue, siteUrl)
  const fields = (issue.fields || {}) as Record<string, unknown>
  const content = buildIssueContent(fields)

  return {
    ...stub,
    content,
    contentDeferred: false,
  }
}

export const jiraConnector: ConnectorConfig = {
  ...jiraConnectorMeta,

  /**
   * A member whose token reaches no Atlassian site, or only sites other than
   * the configured one, lists nothing: a complete listing of nothing, not an error.
   */
  isListingScopeUnavailableError: (error) =>
    isListingScopeUnavailableError(error) ||
    error instanceof AtlassianSiteNotAccessibleError ||
    error instanceof AtlassianSiteNotMatchedError,

  listDocuments: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>,
    cursor?: string,
    syncContext?: Record<string, unknown>
  ): Promise<ExternalDocumentList> => {
    const domain = sourceConfig.domain as string
    const siteUrl = normalizeAtlassianSiteUrl(domain)
    const projectKeys = parseMultiValue(sourceConfig.projectKey)
    const jqlFilter = (sourceConfig.jql as string) || ''
    const maxIssues = sourceConfig.maxIssues ? Number(sourceConfig.maxIssues) : 0

    if (projectKeys.length === 0) {
      throw new Error('At least one project key is required')
    }

    let cloudId = syncContext?.cloudId as string | undefined
    if (!cloudId) {
      cloudId = await getJiraCloudId(domain, accessToken)
      if (syncContext) syncContext.cloudId = cloudId
    }

    const projectClause = buildProjectClause(projectKeys)
    let jql = `${projectClause} ORDER BY updated DESC`
    if (jqlFilter.trim()) {
      jql = `${projectClause} AND (${jqlFilter.trim()}) ORDER BY updated DESC`
    }

    /**
     * Collected-count is encoded in the cursor as `${pageToken}|${count}` so
     * the maxIssues cap works correctly even when the caller doesn't pass
     * syncContext. Falls back to syncContext.collectedCount for backwards
     * compatibility with cursors emitted before this format existed.
     */
    let pageToken: string | undefined
    let collectedSoFar = (syncContext?.collectedCount as number | undefined) ?? 0
    if (cursor) {
      const sep = cursor.lastIndexOf('|')
      if (sep > 0) {
        pageToken = cursor.slice(0, sep)
        const parsed = Number(cursor.slice(sep + 1))
        if (Number.isFinite(parsed) && parsed >= 0) collectedSoFar = parsed
      } else {
        pageToken = cursor
      }
    }

    const remaining = maxIssues > 0 ? Math.max(0, maxIssues - collectedSoFar) : PAGE_SIZE
    if (maxIssues > 0 && remaining === 0) {
      /**
       * The cap was already exhausted by an earlier page, so this listing is a
       * strict subset of the source. Flag it so the sync engine does not treat
       * the missing issues as deletions.
       */
      if (syncContext) syncContext.listingCapped = true
      return { documents: [], hasMore: false }
    }

    const params = new URLSearchParams()
    params.append('jql', jql)
    params.append('maxResults', String(Math.min(PAGE_SIZE, remaining)))
    params.append(
      'fields',
      'summary,issuetype,status,priority,assignee,reporter,project,labels,created,updated'
    )
    if (pageToken) params.append('nextPageToken', pageToken)

    const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql?${params.toString()}`

    logger.info(`Listing Jira issues for ${projectKeys.length} project(s)`, {
      projectKeys,
      hasCursor: Boolean(cursor),
    })

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      logger.error('Failed to search Jira issues', {
        status: response.status,
        error: errorText,
      })
      throw listingRequestError(
        'Failed to search Jira issues',
        response.status,
        response.status === 404 ||
          (response.status === 400 && /does not exist for the field 'project'/i.test(errorText))
      )
    }

    const data = await response.json()
    let issues = (data.issues || []) as Record<string, unknown>[]
    /**
     * `/rest/api/3/search/jql` signals end-of-results purely by the absence of
     * `nextPageToken` — the parameter docs state the field "is **not included**
     * in the response for the last page". `data.isLast` carries the same intent
     * but is redundant, so the token is the single source of truth here.
     */
    const nextPageToken = data.nextPageToken as string | undefined
    const isLast = !nextPageToken

    let slicedByCap = false
    if (maxIssues > 0 && issues.length > remaining) {
      issues = issues.slice(0, remaining)
      slicedByCap = true
    }

    /**
     * `warnings` is documented as covering the cases where the server itself
     * degraded the result set — "when a JQL clause exceeded its argument limit
     * or when the result set was truncated due to an ingestion limit" — so any
     * warning means this page is not a faithful view of the source. The field is
     * flagged Experimental and "may be absent, empty, or change shape without
     * notice", so only its presence is relied on, never its contents.
     */
    const warnings = data.warnings as Array<{ type?: string; message?: string }> | undefined
    const serverDegradedResults = Boolean(warnings?.length)
    if (serverDegradedResults) {
      logger.warn('Jira search returned warnings; skipping deletion reconciliation', { warnings })
    }

    const documents: ExternalDocument[] = issues.map((issue) => issueToStub(issue, siteUrl))

    const newCollected = collectedSoFar + issues.length
    if (syncContext) syncContext.collectedCount = newCollected

    const reachedCap = maxIssues > 0 && newCollected >= maxIssues
    const hasMore = !isLast && !reachedCap

    /**
     * The sync engine hard-deletes stored documents absent from a complete
     * listing, so a `maxIssues` cap that truncated the source set must suppress
     * reconciliation. Only flag when issues actually remain unlisted — a cap
     * that happens to land exactly on the last page is genuine exhaustion and
     * must still reconcile deletions. The user-supplied JQL filter is an
     * intentional scope narrowing and deliberately does NOT flag.
     */
    if ((slicedByCap || (reachedCap && !isLast) || serverDegradedResults) && syncContext) {
      syncContext.listingCapped = true
    }

    return {
      documents,
      nextCursor: hasMore && nextPageToken ? `${nextPageToken}|${newCollected}` : undefined,
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
    const siteUrl = normalizeAtlassianSiteUrl(domain)
    let cloudId = syncContext?.cloudId as string | undefined
    if (!cloudId) {
      cloudId = await getJiraCloudId(domain, accessToken)
      if (syncContext) syncContext.cloudId = cloudId
    }

    const params = new URLSearchParams()
    params.append(
      'fields',
      'summary,description,comment,issuetype,status,priority,assignee,reporter,project,labels,created,updated'
    )

    const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue/${encodeURIComponent(externalId)}?${params.toString()}`

    const response = await fetchWithRetry(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
    })

    if (!response.ok) {
      if (response.status === 404) return null
      throw new Error(`Failed to get Jira issue: ${response.status}`)
    }

    const issue = await response.json()
    return issueToFullDocument(issue, siteUrl)
  },

  validateConfig: async (
    accessToken: string,
    sourceConfig: Record<string, unknown>
  ): Promise<{ valid: boolean; error?: string }> => {
    const domain = sourceConfig.domain as string
    const projectKeys = parseMultiValue(sourceConfig.projectKey)

    if (!domain || projectKeys.length === 0) {
      return { valid: false, error: 'Domain and at least one project key are required' }
    }

    const maxIssues = sourceConfig.maxIssues as string | undefined
    if (maxIssues && (Number.isNaN(Number(maxIssues)) || Number(maxIssues) <= 0)) {
      return { valid: false, error: 'Max issues must be a positive number' }
    }

    const jqlFilter = (sourceConfig.jql as string | undefined)?.trim() || ''

    try {
      const cloudId = await getJiraCloudId(domain, accessToken, VALIDATE_RETRY_OPTIONS)

      const projectClause = buildProjectClause(projectKeys)
      const params = new URLSearchParams()
      params.append('jql', projectClause)
      params.append('maxResults', '1')

      const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql?${params.toString()}`
      const response = await fetchWithRetry(
        url,
        {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
        },
        VALIDATE_RETRY_OPTIONS
      )

      if (!response.ok) {
        const errorText = await response.text()
        if (response.status === 400) {
          return {
            valid: false,
            error: `One or more projects not found or not accessible: ${projectKeys.join(', ')}`,
          }
        }
        return { valid: false, error: `Failed to validate: ${response.status} - ${errorText}` }
      }

      if (jqlFilter) {
        const filterParams = new URLSearchParams()
        filterParams.append('jql', `${projectClause} AND (${jqlFilter})`)
        filterParams.append('maxResults', '1')

        const filterUrl = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/search/jql?${filterParams.toString()}`
        const filterResponse = await fetchWithRetry(
          filterUrl,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${accessToken}`,
            },
          },
          VALIDATE_RETRY_OPTIONS
        )

        if (!filterResponse.ok) {
          return { valid: false, error: 'Invalid JQL filter. Check syntax and field names.' }
        }
      }

      return { valid: true }
    } catch (error) {
      return { valid: false, error: toError(error).message || 'Failed to validate configuration' }
    }
  },

  mapTags: (metadata: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {}

    if (typeof metadata.issueType === 'string') result.issueType = metadata.issueType
    if (typeof metadata.status === 'string') result.status = metadata.status
    if (typeof metadata.priority === 'string') result.priority = metadata.priority

    const labels = joinTagArray(metadata.labels)
    if (labels) result.labels = labels

    if (typeof metadata.assignee === 'string') result.assignee = metadata.assignee

    const updated = parseTagDate(metadata.updated)
    if (updated) result.updated = updated

    return result
  },
}
